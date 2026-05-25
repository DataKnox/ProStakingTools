import React, { useMemo, useState } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import StakeAccountList from './components/StakeAccountList';
import StakeModal from './components/StakeModal';
import { RPC_ENDPOINT } from './config/solana';
import './App.css';

require('@solana/wallet-adapter-react-ui/styles.css');

const App = () => {
  const [isStakeModalOpen, setIsStakeModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  const handleStakeSuccess = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
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
              <StakeAccountList key={refreshKey} />
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
