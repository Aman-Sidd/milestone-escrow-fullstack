import { useState } from "react";
import "./index.css";
import WalletBar from "./components/WalletBar";
import CreateEscrow from "./components/CreateEscrow";
import ClientDashboard from "./components/ClientDashboard";
import FreelancerDashboard from "./components/FreelancerDashboard";
import ArbiterDashboard from "./components/ArbiterDashboard";
import { useWallet } from "./hooks/useWallet";
import { EXPECTED_CHAIN_ID, NETWORK_CONFIG, NATIVE_TOKEN_SYMBOL } from "./config";

const MODULES = [
  { id: "create", label: "Create Escrow" },
  { id: "client", label: "Client Dashboard" },
  { id: "freelancer", label: "Freelancer Dashboard" },
  { id: "arbiter", label: "Arbiter Dashboard" },
];

export default function App() {
  const [activeModule, setActiveModule] = useState("create");
  const {
    account,
    balance,
    chainName,
    isConnecting,
    isCorrectNetwork,
    error,
    hasMetaMask,
    connectWallet,
    switchNetwork,
    nativeTokenSymbol,
  } = useWallet();

  const connectionReady = account && isCorrectNetwork;

  return (
    <div className="app-shell">
      <WalletBar
        account={account}
        balance={balance}
        chainName={chainName}
        isConnecting={isConnecting}
        isCorrectNetwork={isCorrectNetwork}
        nativeTokenSymbol={nativeTokenSymbol}
        onConnect={connectWallet}
      />

      <main className="app-main">
        <section className="wallet-panel wallet-panel--full">
          {!hasMetaMask && (
            <div className="message-box message-box--error">
              MetaMask was not detected. Install the extension, then refresh this page.
            </div>
          )}

          {error && <div className="message-box message-box--error">{error}</div>}

          {!connectionReady ? (
            <>
              <div className="panel-header">
                <h2>Wallet Status</h2>
                <span className="status-pill">Action Needed</span>
              </div>

              <div className="detail-list">
                <div className="detail-row">
                  <span>Connected account</span>
                  <strong>{account || "Not connected"}</strong>
                </div>
                <div className="detail-row">
                  <span>Network</span>
                  <strong>{chainName || "Unknown"}</strong>
                </div>
                <div className="detail-row">
                  <span>Balance</span>
                  <strong>{balance ? `${balance} ${NATIVE_TOKEN_SYMBOL}` : "-"}</strong>
                </div>
                <div className="detail-row">
                  <span>Expected network</span>
                  <strong>{`${NETWORK_CONFIG.chainName} (Chain ID ${EXPECTED_CHAIN_ID})`}</strong>
                </div>
              </div>

              <div className="action-row">
                {!account ? (
                  <button
                    className="primary-button"
                    onClick={connectWallet}
                    disabled={isConnecting || !hasMetaMask}
                  >
                    {isConnecting ? "Connecting..." : "Connect MetaMask"}
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    onClick={switchNetwork}
                    disabled={!hasMetaMask}
                  >
                    {`Switch to ${NETWORK_CONFIG.chainName}`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <nav className="module-tabs" aria-label="Frontend modules">
                {MODULES.map((module) => (
                  <button
                    key={module.id}
                    className={`module-tab ${activeModule === module.id ? "module-tab--active" : ""}`}
                    onClick={() => setActiveModule(module.id)}
                  >
                    {module.label}
                  </button>
                ))}
              </nav>

              {activeModule === "create" && <CreateEscrow account={account} />}
              {activeModule === "client" && <ClientDashboard account={account} />}
              {activeModule === "freelancer" && <FreelancerDashboard account={account} />}
              {activeModule === "arbiter" && <ArbiterDashboard account={account} />}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
