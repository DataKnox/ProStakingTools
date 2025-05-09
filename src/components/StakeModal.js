import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, SystemProgram, StakeProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import Toast from './Toast';

const StakeModal = ({ isOpen, onClose, onSuccess }) => {
    const { publicKey, sendTransaction } = useWallet();
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);

    const connection = new Connection('https://cherise-ldxzh0-fast-mainnet.helius-rpc.com');
    // ProStaking's vote account address
    const PROSTAKING_VOTE_ACCOUNT = 'juicQdAnksqZ5Yb8NQwCLjLWhykvXGktxnQCDvMe6Nx';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!publicKey) return;

        try {
            setLoading(true);

            const amountInLamports = parseFloat(amount) * LAMPORTS_PER_SOL;
            console.log('Amount in lamports:', amountInLamports);

            // Generate a new keypair for the stake account
            const stakeAccount = Keypair.generate();
            console.log('Stake account pubkey:', stakeAccount.publicKey.toString());

            // Get the minimum balance for rent exemption
            const rentExemptReserve = await connection.getMinimumBalanceForRentExemption(
                StakeProgram.space
            );
            console.log('Rent exempt reserve:', rentExemptReserve);

            // Calculate total lamports needed (stake amount + rent exempt reserve)
            const totalLamports = amountInLamports + rentExemptReserve;
            console.log('Total lamports needed:', totalLamports);

            // Get the balance of the wallet
            const balance = await connection.getBalance(publicKey);
            console.log('Wallet balance:', balance);

            if (balance < totalLamports) {
                throw new Error(`Insufficient balance. Need ${totalLamports / LAMPORTS_PER_SOL} SOL (including rent-exempt reserve)`);
            }

            // Verify the vote account exists and is valid
            const voteAccountInfo = await connection.getAccountInfo(new PublicKey(PROSTAKING_VOTE_ACCOUNT));
            if (!voteAccountInfo) {
                throw new Error('Invalid vote account address');
            }

            // Create the create account instruction
            const createAccountInstruction = StakeProgram.createAccount({
                fromPubkey: publicKey,
                stakePubkey: stakeAccount.publicKey,
                authorized: {
                    staker: publicKey,
                    withdrawer: publicKey,
                },
                lamports: totalLamports,
                lockup: {
                    epoch: 0,
                    unixTimestamp: 0,
                    custodian: publicKey,
                },
            });

            // Create the delegate instruction
            const delegateInstruction = StakeProgram.delegate({
                stakePubkey: stakeAccount.publicKey,
                authorizedPubkey: publicKey,
                votePubkey: new PublicKey(PROSTAKING_VOTE_ACCOUNT),
            });

            // Get the latest blockhash
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

            // Create the transaction
            const transaction = new Transaction()
                .add(createAccountInstruction)
                .add(delegateInstruction);

            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Show transaction submitted toast
            setToast({
                message: 'Please approve the transaction in your wallet...',
                type: 'success'
            });

            // Send the transaction
            const signature = await sendTransaction(transaction, connection, {
                signers: [stakeAccount]
            });
            console.log('Transaction signature:', signature);

            // Show confirmation toast
            setToast({
                message: 'Transaction submitted. Waiting for confirmation...',
                type: 'success'
            });

            // Wait for confirmation with timeout
            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            });
            console.log('Transaction confirmation:', confirmation);

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            // Show success toast
            setToast({
                message: 'Stake account created and delegated to ProStaking successfully!',
                type: 'success'
            });

            onSuccess();
            onClose();
        } catch (err) {
            console.error('Error creating stake account:', err);
            // Show detailed error message
            const errorMessage = err.message.includes('User rejected')
                ? 'Transaction cancelled'
                : `Error creating stake account: ${err.message}`;

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
                <h2>Stake SOL with ProStaking</h2>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="amount">Amount (SOL)</label>
                        <input
                            type="number"
                            id="amount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            min="0"
                            step="0.1"
                            required
                            placeholder="Enter amount to stake"
                        />
                    </div>
                    <div className="modal-actions">
                        <button type="button" onClick={onClose} className="cancel-button">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="submit-button"
                            disabled={loading}
                        >
                            {loading ? 'Processing...' : 'Stake with ProStaking'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default StakeModal; 