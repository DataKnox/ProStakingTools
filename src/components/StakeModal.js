import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    PublicKey,
    Transaction,
    StakeProgram,
    LAMPORTS_PER_SOL,
    Keypair,
    Authorized,
    Lockup,
    VOTE_PROGRAM_ID,
} from '@solana/web3.js';
import Toast from './Toast';
import { connection, PROSTAKING_VOTE_ACCOUNT } from '../config/solana';
import { parseSolAmount } from '../utils/validation';

const StakeModal = ({ isOpen, onClose, onSuccess }) => {
    const { publicKey, sendTransaction } = useWallet();
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!publicKey) return;

        try {
            setLoading(true);

            const amountInLamports = parseSolAmount(amount);

            const stakeAccount = Keypair.generate();

            const rentExemptReserve = await connection.getMinimumBalanceForRentExemption(
                StakeProgram.space
            );

            const totalLamports = amountInLamports + rentExemptReserve;

            const balance = await connection.getBalance(publicKey);
            if (balance < totalLamports) {
                throw new Error(
                    `Insufficient balance. Need ${totalLamports / LAMPORTS_PER_SOL} SOL (including rent-exempt reserve)`
                );
            }

            const voteAccountInfo = await connection.getAccountInfo(PROSTAKING_VOTE_ACCOUNT);
            if (!voteAccountInfo) {
                throw new Error('Vote account not found');
            }
            if (!voteAccountInfo.owner.equals(VOTE_PROGRAM_ID)) {
                throw new Error('Configured vote account is not owned by the Vote program');
            }

            const createAccountInstruction = StakeProgram.createAccount({
                fromPubkey: publicKey,
                stakePubkey: stakeAccount.publicKey,
                authorized: new Authorized(publicKey, publicKey),
                lamports: totalLamports,
                lockup: new Lockup(0, 0, PublicKey.default),
            });

            const delegateInstruction = StakeProgram.delegate({
                stakePubkey: stakeAccount.publicKey,
                authorizedPubkey: publicKey,
                votePubkey: PROSTAKING_VOTE_ACCOUNT,
            });

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

            const transaction = new Transaction()
                .add(createAccountInstruction)
                .add(delegateInstruction);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            setToast({
                message: 'Please approve the transaction in your wallet...',
                type: 'success'
            });

            const signature = await sendTransaction(transaction, connection, {
                signers: [stakeAccount]
            });

            setToast({
                message: 'Transaction submitted. Waiting for confirmation...',
                type: 'success'
            });

            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            });

            if (confirmation.value.err) {
                throw new Error('Transaction failed on chain');
            }

            setToast({
                message: 'Stake account created and delegated to ProStaking successfully!',
                type: 'success'
            });

            onSuccess();
            onClose();
        } catch (err) {
            const errorMessage = err?.message?.includes('User rejected')
                ? 'Transaction cancelled'
                : `Error creating stake account: ${err?.message ?? 'unknown error'}`;

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
                            min="0.000000001"
                            max="1000000"
                            step="0.000000001"
                            required
                            placeholder="Enter amount to stake"
                            inputMode="decimal"
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
