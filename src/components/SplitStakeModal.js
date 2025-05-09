import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    Connection,
    PublicKey,
    Transaction,
    StakeProgram,
    ComputeBudgetProgram,
    Keypair,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import Toast from './Toast';

const SplitStakeModal = ({ isOpen, onClose, onSuccess, stakeAccount }) => {
    const { publicKey, signTransaction } = useWallet();
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');

    const connection = new Connection('https://cherise-ldxzh0-fast-mainnet.helius-rpc.com');

    const checkTransactionStatus = async (signature, timeout = 120000) => {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            try {
                const status = await connection.getSignatureStatus(signature);

                if (status && status.value) {
                    // Check for any errors
                    if (status.value.err) {
                        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
                    }

                    // Consider both 'confirmed' and 'finalized' as successful
                    if (status.value.confirmationStatus === 'confirmed' ||
                        status.value.confirmationStatus === 'finalized') {
                        return true;
                    }
                }
            } catch (err) {
                // Silent error handling
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
        }
        return false;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!publicKey || !stakeAccount || !amount || !signTransaction) return;

        try {
            setLoading(true);
            setError('');

            const amountSOL = parseFloat(amount);
            if (isNaN(amountSOL) || amountSOL <= 0) {
                throw new Error('Please enter a valid amount');
            }

            // Generate new stake account keypair
            const newStakeAccount = Keypair.generate();

            // Check if the generated account already exists
            const accountInfo = await connection.getAccountInfo(newStakeAccount.publicKey);
            if (accountInfo !== null) {
                throw new Error("An account with the generated public key already exists.");
            }

            // Get rent-exempt balance
            const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);
            const lamportsToSplit = amountSOL * LAMPORTS_PER_SOL;

            if (lamportsToSplit <= rentExemptBalance) {
                throw new Error("Amount to split must be greater than the rent-exempt minimum");
            }

            // Create split instruction
            const splitInstruction = StakeProgram.split({
                stakePubkey: new PublicKey(stakeAccount.address),
                authorizedPubkey: publicKey,
                splitStakePubkey: newStakeAccount.publicKey,
                lamports: lamportsToSplit
            });

            // Add priority fee instruction
            const PRIORITY_FEE_IX = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 });

            // Create and configure the transaction
            const transaction = new Transaction()
                .add(splitInstruction)
                .add(PRIORITY_FEE_IX);

            // Get the latest blockhash
            const { blockhash } = await connection.getRecentBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Show transaction submitted toast
            setToast({
                message: 'Please approve the transaction in your wallet...',
                type: 'success'
            });

            // Sign the transaction
            const signedTransaction = await signTransaction(transaction);

            // Add the new stake account's signature
            signedTransaction.partialSign(newStakeAccount);

            // Send the raw transaction
            const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3
            });

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
                message: 'Stake account split successfully!',
                type: 'success'
            });

            onSuccess();
            onClose();
        } catch (err) {
            setError(err.message);
            setToast({
                message: `Error splitting stake account: ${err.message}`,
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
                            min="0"
                            required
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