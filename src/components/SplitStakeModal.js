import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    Transaction,
    StakeProgram,
    ComputeBudgetProgram,
    Keypair,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import Toast from './Toast';
import { connection } from '../config/solana';
import { parseSolAmount, toPublicKey } from '../utils/validation';

const CONFIRM_TIMEOUT_MS = 120000;

const SplitStakeModal = ({ isOpen, onClose, onSuccess, stakeAccount }) => {
    const { publicKey, signTransaction } = useWallet();
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');

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
        if (!publicKey || !stakeAccount || !amount || !signTransaction) return;

        try {
            setLoading(true);
            setError('');

            const lamportsToSplit = parseSolAmount(amount);

            const sourceStakePubkey = toPublicKey(stakeAccount.address, 'source stake account');

            const newStakeAccount = Keypair.generate();

            const accountInfo = await connection.getAccountInfo(newStakeAccount.publicKey);
            if (accountInfo !== null) {
                throw new Error('Generated stake account collides with an existing one; please retry');
            }

            const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);

            if (lamportsToSplit <= rentExemptBalance) {
                throw new Error(
                    `Amount must be greater than rent-exempt minimum (~${(rentExemptBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL)`
                );
            }

            const splitTx = StakeProgram.split(
                {
                    stakePubkey: sourceStakePubkey,
                    authorizedPubkey: publicKey,
                    splitStakePubkey: newStakeAccount.publicKey,
                    lamports: lamportsToSplit
                },
                rentExemptBalance
            );

            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 });

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

            const transaction = new Transaction()
                .add(...splitTx.instructions)
                .add(priorityFeeIx);
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;
            transaction.feePayer = publicKey;

            setToast({
                message: 'Please approve the transaction in your wallet...',
                type: 'success'
            });

            const signedTransaction = await signTransaction(transaction);
            signedTransaction.partialSign(newStakeAccount);

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
                message: 'Stake account split successfully!',
                type: 'success'
            });

            onSuccess();
            onClose();
        } catch (err) {
            const message = err?.message ?? 'unknown error';
            setError(message);
            setToast({
                message: `Error splitting stake account: ${message}`,
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
                <h2>Split Stake Account</h2>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Source Account</label>
                        <div className="stake-account-info">
                            <p>Address: {stakeAccount?.address}</p>
                            <p>Amount: {stakeAccount?.amount.toFixed(4)} SOL</p>
                            <p>Status: {stakeAccount?.state}</p>
                        </div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="splitAmount">Amount to Split (SOL)</label>
                        <input
                            type="number"
                            id="splitAmount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            step="0.000000001"
                            min="0.000000001"
                            max="1000000"
                            required
                            inputMode="decimal"
                        />
                        {error && <p className="error-message">{error}</p>}
                    </div>
                    <div className="modal-actions">
                        <button type="button" onClick={onClose} className="cancel-button">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="submit-button"
                            disabled={loading || !amount}
                        >
                            {loading ? 'Processing...' : 'Split Account'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SplitStakeModal;
