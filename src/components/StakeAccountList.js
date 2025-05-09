import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, PublicKey, StakeProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Transaction } from '@solana/web3.js';
import Toast from './Toast';
import MergeStakeModal from './MergeStakeModal';
import SplitStakeModal from './SplitStakeModal';

const StakeAccountList = () => {
    const { publicKey, connected, sendTransaction } = useWallet();
    const [stakeAccounts, setStakeAccounts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deactivatingAccount, setDeactivatingAccount] = useState(null);
    const [toast, setToast] = useState(null);
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [splitModalOpen, setSplitModalOpen] = useState(false);
    const [selectedStakeAccount, setSelectedStakeAccount] = useState(null);

    const connection = new Connection('https://cherise-ldxzh0-fast-mainnet.helius-rpc.com');

    const fetchValidatorInfo = async (voteAccount) => {
        const url = `https://api.stakewiz.com/validator/${voteAccount}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return {
                name: data.name || `Validator ${voteAccount.slice(0, 8)}`,
                image: data.image || null
            };
        } catch (error) {
            console.error("Failed to fetch validator info:", error);
            return {
                name: `Validator ${voteAccount.slice(0, 8)}`,
                image: null
            };
        }
    };

    const fetchStakeAccounts = async () => {
        if (!publicKey) return;

        try {
            setLoading(true);

            const accounts = await connection.getParsedProgramAccounts(
                StakeProgram.programId,
                {
                    filters: [
                        {
                            memcmp: {
                                offset: 44,
                                bytes: publicKey.toBase58(),
                            },
                        },
                    ],
                }
            );

            const stakeAccountsData = await Promise.all(
                accounts.map(async (account) => {
                    const stakeInfo = account.account.data.parsed.info;
                    const amount = stakeInfo.stake?.delegation?.stake
                        ? stakeInfo.stake.delegation.stake / LAMPORTS_PER_SOL
                        : stakeInfo.meta?.lamports / LAMPORTS_PER_SOL;

                    // If the account is not delegated, return basic info
                    if (!stakeInfo.stake?.delegation) {
                        return {
                            address: account.pubkey.toString(),
                            validatorAddress: null,
                            amount: amount,
                            validatorName: 'Not Delegated',
                            validatorImage: null,
                            state: 'inactive'
                        };
                    }

                    const voteAccountAddress = stakeInfo.stake.delegation.voter.toString();
                    const validatorInfo = await fetchValidatorInfo(voteAccountAddress);

                    // Determine the state based on the stake account data
                    let state = 'inactive';
                    if (stakeInfo.stake?.delegation) {
                        const currentEpoch = await connection.getEpochInfo();
                        const activationEpoch = Number(stakeInfo.stake.delegation.activationEpoch);
                        const deactivationEpoch = stakeInfo.stake.delegation.deactivationEpoch;

                        console.log('Stake account state check:', {
                            address: account.pubkey.toString(),
                            currentEpoch: currentEpoch.epoch,
                            activationEpoch,
                            deactivationEpoch,
                            delegation: stakeInfo.stake.delegation
                        });

                        // Check if the account is not deactivating (max uint64 value)
                        const isNotDeactivating = deactivationEpoch === '18446744073709551615' || deactivationEpoch === 0;

                        if (isNotDeactivating) {
                            // If activation epoch is greater than or equal to current epoch, it's still activating
                            if (activationEpoch >= currentEpoch.epoch) {
                                state = 'activating';
                            } else {
                                state = 'active';
                            }
                        } else if (Number(deactivationEpoch) > currentEpoch.epoch) {
                            state = 'deactivating';
                        } else {
                            state = 'inactive';
                        }

                        console.log('Determined state:', state, {
                            isActivating: activationEpoch >= currentEpoch.epoch,
                            activationEpoch,
                            currentEpoch: currentEpoch.epoch
                        });
                    }

                    return {
                        address: account.pubkey.toString(),
                        validatorAddress: voteAccountAddress,
                        amount: amount,
                        validatorName: validatorInfo.name,
                        validatorImage: validatorInfo.image,
                        state: state
                    };
                })
            );

            setStakeAccounts(stakeAccountsData);
        } catch (err) {
            setToast({
                message: 'Error fetching stake accounts: ' + err.message,
                type: 'error'
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (connected) {
            fetchStakeAccounts();
        }
    }, [connected, publicKey]);

    const handleDeactivate = async (stakeAccountAddress) => {
        if (!publicKey) return;

        try {
            setDeactivatingAccount(stakeAccountAddress);

            // Create the deactivate instruction
            const deactivateInstruction = StakeProgram.deactivate({
                stakePubkey: new PublicKey(stakeAccountAddress),
                authorizedPubkey: publicKey,
            });

            // Create the transaction
            const transaction = new Transaction().add(deactivateInstruction);

            // Get the latest blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Send the transaction
            const signature = await sendTransaction(transaction, connection);

            // Wait for confirmation
            await connection.confirmTransaction(signature);

            // Show success toast
            setToast({
                message: 'Stake account deactivated successfully',
                type: 'success'
            });

            // Refresh the stake accounts list
            await fetchStakeAccounts();
        } catch (err) {
            console.error('Error deactivating stake account:', err);
            // Show user-friendly error message
            const errorMessage = err.message.includes('User rejected')
                ? 'Transaction cancelled'
                : 'Error deactivating stake account';

            setToast({
                message: errorMessage,
                type: 'error'
            });
        } finally {
            setDeactivatingAccount(null);
        }
    };

    const handleMerge = (stakeAccount) => {
        console.log('Selected stake account for merge:', stakeAccount);
        setSelectedStakeAccount(stakeAccount);
        setMergeModalOpen(true);
    };

    const handleMergeSuccess = () => {
        fetchStakeAccounts();
    };

    const handleSplit = (stakeAccount) => {
        setSelectedStakeAccount(stakeAccount);
        setSplitModalOpen(true);
    };

    const handleSplitSuccess = () => {
        fetchStakeAccounts();
    };

    const handleTransfer = async (stakeAccountAddress) => {
        // Implement transfer stake logic
    };

    if (!connected) {
        return (
            <div className="connect-wallet">
                <h2>Please connect your wallet to view stake accounts</h2>
                <WalletMultiButton />
            </div>
        );
    }

    if (loading) {
        return <div>Loading stake accounts...</div>;
    }

    return (
        <div className="stake-accounts-container">
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
            <h2>Your Stake Accounts</h2>
            {loading ? (
                <p>Loading stake accounts...</p>
            ) : stakeAccounts.length === 0 ? (
                <p>No stake accounts found.</p>
            ) : (
                <div className="stake-accounts-table-container">
                    <table className="stake-accounts-table">
                        <thead>
                            <tr>
                                <th>Validator</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stakeAccounts.map((account) => (
                                <tr key={account.address}>
                                    <td>
                                        <div className="validator-info">
                                            {account.validatorImage && (
                                                <img
                                                    src={account.validatorImage}
                                                    alt={account.validatorName}
                                                    className="validator-image"
                                                />
                                            )}
                                            <div className="validator-details">
                                                <span className="validator-name">
                                                    {account.validatorName}
                                                </span>
                                                {account.validatorWebsite && (
                                                    <a
                                                        href={account.validatorWebsite}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="validator-website"
                                                    >
                                                        Website
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td>{account.amount.toFixed(4)} SOL</td>
                                    <td>{account.state}</td>
                                    <td>
                                        <div className="action-buttons">
                                            <button
                                                onClick={() => handleMerge(account)}
                                                className="action-button merge-button"
                                            >
                                                Merge
                                            </button>
                                            <button
                                                onClick={() => handleSplit(account)}
                                                className="action-button split-button"
                                            >
                                                Split
                                            </button>
                                            <button
                                                onClick={() => handleTransfer(account.address)}
                                                className="action-button transfer-button"
                                            >
                                                Transfer
                                            </button>
                                            {account.state === 'active' && (
                                                <button
                                                    onClick={() => handleDeactivate(account.address)}
                                                    className="action-button deactivate-button"
                                                >
                                                    Deactivate
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <MergeStakeModal
                isOpen={mergeModalOpen}
                onClose={() => setMergeModalOpen(false)}
                onSuccess={handleMergeSuccess}
                sourceStakeAccount={selectedStakeAccount}
                stakeAccounts={stakeAccounts}
            />
            <SplitStakeModal
                isOpen={splitModalOpen}
                onClose={() => setSplitModalOpen(false)}
                onSuccess={handleSplitSuccess}
                stakeAccount={selectedStakeAccount}
            />
        </div>
    );
};

export default StakeAccountList; 