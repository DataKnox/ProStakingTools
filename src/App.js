import React, { FC, useMemo, useState } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import StakeAccountList from './components/StakeAccountList';
import StakeModal from './components/StakeModal';
import { Connection } from '@solana/web3.js';
import './App.css';

// Default styles that can be overridden by your app
require('@solana/wallet-adapter-react-ui/styles.css');

const App = () => {
  const [isStakeModalOpen, setIsStakeModalOpen] = useState(false);
  const network = WalletAdapterNetwork.MainnetBeta;
  const endpoint = 'https://cherise-ldxzh0-fast-mainnet.helius-rpc.com';

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
    ],
    [network]
  );

  const handleStakeSuccess = () => {
    // Refresh the stake accounts list
    window.location.reload();
  };

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="App">
            <header>
              <h1>Solana Stake Account Manager</h1>
              <button
                className="stake-now-button"
                onClick={() => setIsStakeModalOpen(true)}
              >
                Stake Now
              </button>
            </header>
            <main>
              <StakeAccountList />
            </main>
            <StakeModal
              isOpen={isStakeModalOpen}
              onClose={() => setIsStakeModalOpen(false)}
              onSuccess={handleStakeSuccess}
            />
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;
