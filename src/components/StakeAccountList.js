import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, StakeProgram, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import Toast from './Toast';
import MergeStakeModal from './MergeStakeModal';
import SplitStakeModal from './SplitStakeModal';
import { connection } from '../config/solana';
import { isSafeHttpsUrl } from '../utils/validation';

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VALIDATOR_FETCH_TIMEOUT_MS = 5000;

const StakeAccountList = () => {
    const { publicKey, connected, sendTransaction } = useWallet();
    const [stakeAccounts, setStakeAccounts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deactivatingAccount, setDeactivatingAccount] = useState(null);
    const [toast, setToast] = useState(null);
    const [mergeModalOpen, setMergeModalOpen] = useState(false);
    const [splitModalOpen, setSplitModalOpen] = useState(false);
    const [selectedStakeAccount, setSelectedStakeAccount] = useState(null);

    const fetchValidatorInfo = async (voteAccount) => {
        const fallback = {
            name: `Validator ${voteAccount.slice(0, 8)}`,
            image: null,
        };

        if (!BASE58_PUBKEY.test(voteAccount)) {
            return fallback;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), VALIDATOR_FETCH_TIMEOUT_MS);
        const url = `https://api.stakewiz.com/validator/${encodeURIComponent(voteAccount)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
            });

            if (!response.ok) return fallback;

            const data = await response.json();
            const name = typeof data?.name === 'string' && data.name.length > 0
                ? data.name.slice(0, 128)
                : fallback.name;
            const image = isSafeHttpsUrl(data?.image) ? data.image : null;

            return { name, image };
        } catch {
            return fallback;
        } finally {
            clearTimeout(timeoutId);
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

            const currentEpoch = await connection.getEpochInfo();

            const stakeAccountsData = await Promise.all(
                accounts.map(async (account) => {
                    const stakeInfo = account.account.data.parsed.info;
                    const amount = stakeInfo.stake?.delegation?.stake
                        ? stakeInfo.stake.delegation.stake / LAMPORTS_PER_SOL
                        : stakeInfo.meta?.lamports / LAMPORTS_PER_SOL;

                    if (!stakeInfo.stake?.delegation) {
                        return {
                            address: account.pubkey.toString(),
                            validatorAddress: null,
                            amount,
                            validatorName: 'Not Delegated',
                            validatorImage: null,
                            state: 'inactive'
                        };
                    }

                    const voteAccountAddress = stakeInfo.stake.delegation.voter.toString();
                    const validatorInfo = await fetchValidatorInfo(voteAccountAddress);

                    const activationEpoch = Number(stakeInfo.stake.delegation.activationEpoch);
                    const deactivationEpoch = stakeInfo.stake.delegation.deactivationEpoch;
                    const isNotDeactivating = deactivationEpoch === '18446744073709551615' || deactivationEpoch === 0;

                    let state;
                    if (isNotDeactivating) {
                        state = activationEpoch >= currentEpoch.epoch ? 'activating' : 'active';
                    } else if (Number(deactivationEpoch) > currentEpoch.epoch) {
                        state = 'deactivating';
                    } else {
                        state = 'inactive';
                    }

                    return {
                        address: account.pubkey.toString(),
                        validatorAddress: voteAccountAddress,
                        amount,
                        validatorName: validatorInfo.name,
                        validatorImage: validatorInfo.image,
                        state
                    };
                })
            );

            setStakeAccounts(stakeAccountsData);
        } catch (err) {
            setToast({
                message: 'Error fetching stake accounts',
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected, publicKey]);

    const handleDeactivate = async (stakeAccountAddress) => {
        if (!publicKey) return;

        try {
            setDeactivatingAccount(stakeAccountAddress);

            let stakePubkey;
            try {
                stakePubkey = new PublicKey(stakeAccountAddress);
            } catch {
                throw new Error('Invalid stake account');
            }

            const deactivateInstruction = StakeProgram.deactivate({
                stakePubkey,
                authorizedPubkey: publicKey,
            });

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            const transaction = new Transaction().add(deactivateInstruction);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            const signature = await sendTransaction(transaction, connection);

            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight,
            });

            if (confirmation.value.err) {
                throw new Error('Transaction failed on chain');
            }

            setToast({
                message: 'Stake account deactivated successfully',
                type: 'success'
            });

            await fetchStakeAccounts();
        } catch (err) {
            const errorMessage = err?.message?.includes('User rejected')
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
                                                    alt=""
                                                    className="validator-image"
                                                    referrerPolicy="no-referrer"
                                                    loading="lazy"
                                                />
                                            )}
                                            <div className="validator-details">
                                                <span className="validator-name">
                                                    {account.validatorName}
                                                </span>
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
                                            {account.state === 'active' && (
                                                <button
                                                    onClick={() => handleDeactivate(account.address)}
                                                    disabled={deactivatingAccount === account.address}
                                                    className="action-button deactivate-button"
                                                >
                                                    {deactivatingAccount === account.address ? 'Deactivating...' : 'Deactivate'}
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
