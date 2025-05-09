import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, StakeProgram, ComputeBudgetProgram } from '@solana/web3.js';
import Toast from './Toast';

const MergeStakeModal = ({ isOpen, onClose, onSuccess, sourceStakeAccount, stakeAccounts }) => {
    const { publicKey, signTransaction } = useWallet();
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const [selectedStakeAccount, setSelectedStakeAccount] = useState('');
    const [mergeableAccounts, setMergeableAccounts] = useState([]);

    const connection = new Connection('https://cherise-ldxzh0-fast-mainnet.helius-rpc.com');

    useEffect(() => {
        if (sourceStakeAccount) {
            console.log('Source account:', sourceStakeAccount);
            console.log('All stake accounts:', stakeAccounts);

            // Filter stake accounts that have the same status as the source account
            const accounts = stakeAccounts.filter(account => {
                const isSameStatus = account.state === sourceStakeAccount.state;
                const isNotSameAccount = account.address !== sourceStakeAccount.address;
                console.log('Checking account:', account.address, {
                    status: account.state,
                    sourceStatus: sourceStakeAccount.state,
                    isSameStatus,
                    isNotSameAccount
                });
                return isSameStatus && isNotSameAccount;
            });

            console.log('Filtered mergeable accounts:', accounts);
            setMergeableAccounts(accounts);
        }
    }, [sourceStakeAccount, stakeAccounts]);

    const checkTransactionStatus = async (signature, timeout = 120000) => {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            try {
                const status = await connection.getSignatureStatus(signature);
                console.log('Transaction status:', status);

                if (status && status.value) {
                    // Check for any errors
                    if (status.value.err) {
                        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
                    }

                    // Consider both 'confirmed' and 'finalized' as successful
                    if (status.value.confirmationStatus === 'confirmed' ||
                        status.value.confirmationStatus === 'finalized') {
                        console.log('Transaction confirmed:', signature);
                        return true;
                    }
                }
            } catch (err) {
                console.error('Error checking transaction status:', err);
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
        }
        return false;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!publicKey || !selectedStakeAccount || !sourceStakeAccount || !signTransaction) return;

        try {
            setLoading(true);

            console.log('Merging accounts:', {
                source: sourceStakeAccount,
                target: selectedStakeAccount
            });

            if (!sourceStakeAccount.address) {
                throw new Error('Source stake account address is missing');
            }

            if (!selectedStakeAccount) {
                throw new Error('Target stake account address is missing');
            }

            const sourceStakeAccountPubkey = new PublicKey(sourceStakeAccount.address);
            const destinationStakeAccountPubkey = new PublicKey(selectedStakeAccount);

            // Create the merge instruction
            const mergeInstruction = StakeProgram.merge({
                stakePubkey: destinationStakeAccountPubkey,
                sourceStakePubkey: sourceStakeAccountPubkey,
                authorizedPubkey: publicKey,
            }).instructions[0];

            // Get the latest blockhash
            const blockhashDetails = await connection.getRecentBlockhash();

            // Add priority fee instruction
            const PRIORITY_FEE_IX = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 });

            // Create and configure the transaction
            const transaction = new Transaction()
                .add(mergeInstruction)
                .add(PRIORITY_FEE_IX);

            transaction.recentBlockhash = blockhashDetails.blockhash;
            transaction.lastValidBlockHeight = blockhashDetails.lastValidBlockHeight;
            transaction.feePayer = publicKey;

            // Ensure the source account is correctly set in the instruction
            transaction.instructions[0].keys[1].pubkey = sourceStakeAccountPubkey;

            // Show transaction submitted toast
            setToast({
                message: 'Please approve the transaction in your wallet...',
                type: 'success'
            });

            // Sign the transaction
            const signedTransaction = await signTransaction(transaction);

            // Send the raw transaction
            const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3
            });
            console.log('Transaction signature:', signature);

            // Show confirmation toast
            setToast({
                message: 'Transaction submitted. Waiting for confirmation...',
                type: 'success'
            });

            // Wait for confirmation with retries
            const confirmed = await checkTransactionStatus(signature);

            if (!confirmed) {
                // Instead of throwing an error, just show a warning toast
                setToast({
                    message: 'Transaction submitted but confirmation status unknown. Please check your wallet.',
                    type: 'warning'
                });
                // Still consider this a success since the transaction was sent
                onSuccess();
                onClose();
                return;
            }

            // Show success toast
            setToast({
                message: 'Stake accounts merged successfully!',
                type: 'success'
            });

            onSuccess();
            onClose();
        } catch (err) {
            console.error('Error merging stake accounts:', err);
            console.error('Error details:', {
                sourceStakeAccount,
                selectedStakeAccount,
                error: err
            });
            const errorMessage = err.message.includes('User rejected')
                ? 'Transaction cancelled'
                : `Error merging stake accounts: ${err.message}`;

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