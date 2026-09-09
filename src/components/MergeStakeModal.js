import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction, StakeProgram, ComputeBudgetProgram } from '@solana/web3.js';
import Toast from './Toast';
import { connection } from '../config/solana';
import { toPublicKey } from '../utils/validation';

const CONFIRM_TIMEOUT_MS = 120000;

const MergeStakeModal = ({ isOpen, onClose, onSuccess, sourceStakeAccount, stakeAccounts }) => {
    const { publicKey, signTransaction } = useWallet();
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const [selectedStakeAccount, setSelectedStakeAccount] = useState('');
    const [mergeableAccounts, setMergeableAccounts] = useState([]);

    useEffect(() => {
        if (sourceStakeAccount) {
            const accounts = stakeAccounts.filter(
                (account) =>
                    account.state === sourceStakeAccount.state &&
                    account.address !== sourceStakeAccount.address &&
                    account.validatorAddress === sourceStakeAccount.validatorAddress
            );
            setMergeableAccounts(accounts);
            setSelectedStakeAccount('');
        }
    }, [sourceStakeAccount, stakeAccounts]);

    const waitForConfirmation = async (signature, lastValidBlockHeight) => {
        const startTime = Date.now();
        while (Date.now() - startTime < CONFIRM_TIMEOUT_MS) {
            try {
                const status = await connection.getSignatureStatus(signature);
                if (status?.value?.err) {
                    throw new Error('Transaction failed on chain');
                }
                if (
                    status?.value?.confirmationStatus === 'confirmed' ||
                    status?.value?.confirmationStatus === 'finalized'
                ) {
                    return true;
                }
                const blockHeight = await connection.getBlockHeight();
                if (lastValidBlockHeight && blockHeight > lastValidBlockHeight) {
                    return false;
                }
            } catch (err) {
                if (err?.message === 'Transaction failed on chain') throw err;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        return false;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!publicKey || !selectedStakeAccount || !sourceStakeAccount || !signTransaction) return;

        try {
            setLoading(true);

            if (!sourceStakeAccount.address) {
                throw new Error('Source stake account address is missing');
            }

            const sourceStakeAccountPubkey = toPublicKey(sourceStakeAccount.address, 'source account');
            const destinationStakeAccountPubkey = toPublicKey(selectedStakeAccount, 'destination account');

            if (sourceStakeAccountPubkey.equals(destinationStakeAccountPubkey)) {
                throw new Error('Source and destination must be different accounts');
            }

            const mergeTx = StakeProgram.merge({
                stakePubkey: destinationStakeAccountPubkey,
                // web3.js MergeStakeParams spells this with a capital K
                // (sourceStakePubKey); the lowercase-k variant is silently
                // ignored and leaves the source account key undefined.
                sourceStakePubKey: sourceStakeAccountPubkey,
                authorizedPubkey: publicKey,
            });

            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 });

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

            const transaction = new Transaction()
                .add(...mergeTx.instructions)
                .add(priorityFeeIx);
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;
            transaction.feePayer = publicKey;

            setToast({
                message: 'Please approve the transaction in your wallet...',
                type: 'success'
            });

            const signedTransaction = await signTransaction(transaction);

            const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3
            });

            setToast({
                message: 'Transaction submitted. Waiting for confirmation...',
                type: 'success'
            });

            const confirmed = await waitForConfirmation(signature, lastValidBlockHeight);

            if (!confirmed) {
                setToast({
                    message: 'Transaction submitted but confirmation status unknown. Please check your wallet.',
                    type: 'warning'
                });
                onSuccess();
                onClose();
                return;
            }

            setToast({
                message: 'Stake accounts merged successfully!',
                type: 'success'
            });

            onSuccess();
            onClose();
        } catch (err) {
            const errorMessage = err?.message?.includes('User rejected')
                ? 'Transaction cancelled'
                : `Error merging stake accounts: ${err?.message ?? 'unknown error'}`;

            setToast({
                message: errorMessage,
                type: 'error'
            });
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                {toast && (
                    <Toast
                        message={toast.message}
                        type={toast.type}
                        onClose={() => setToast(null)}
                    />
                )}
                <h2>Merge Stake Accounts</h2>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Source Account</label>
                        <div className="stake-account-info">
                            <p>Address: {sourceStakeAccount?.address}</p>
                            <p>Amount: {sourceStakeAccount?.amount.toFixed(4)} SOL</p>
                            <p>Status: {sourceStakeAccount?.state}</p>
                        </div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="mergeAccount">Select Account to Merge With</label>
                        <select
                            id="mergeAccount"
                            value={selectedStakeAccount}
                            onChange={(e) => setSelectedStakeAccount(e.target.value)}
                            required
                        >
                            <option value="">Select an account</option>
                            {mergeableAccounts.map((account) => (
                                <option key={account.address} value={account.address}>
                                    {account.address.slice(0, 8)}... - {account.amount.toFixed(4)} SOL ({account.state})
                                </option>
                            ))}
                        </select>
                        {mergeableAccounts.length === 0 && (
                            <p className="error-message">No compatible accounts available (same validator and state required).</p>
                        )}
                    </div>
                    <div className="modal-actions">
                        <button type="button" onClick={onClose} className="cancel-button">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="submit-button"
                            disabled={loading || !selectedStakeAccount}
                        >
                            {loading ? 'Processing...' : 'Merge Accounts'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MergeStakeModal;
