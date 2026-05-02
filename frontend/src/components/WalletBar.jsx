function shortenAddress(address) {
  if (!address) {
    return "No wallet";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletBar({
  account,
  balance,
  chainName,
  isConnecting,
  isCorrectNetwork,
  nativeTokenSymbol,
  onConnect,
}) {
  return (
    <header className="wallet-bar">
      <div>
        <p className="brand-kicker">Hackathon Build</p>
        <h2 className="brand-title">TrustFlow</h2>
        <p className="brand-subtitle">Milestone escrow for clients, freelancers, and arbiters</p>
      </div>

      <div className="wallet-summary">
        {account ? (
          <>
            <div className={`wallet-chip ${isCorrectNetwork ? "" : "wallet-chip--warning"}`}>
              <span className={`network-dot ${isCorrectNetwork ? "network-dot--ok" : ""}`} />
              <span>{isCorrectNetwork ? chainName || "Connected network" : "Wrong network"}</span>
            </div>
            <div className="wallet-chip">
              {balance ? `${balance} ${nativeTokenSymbol}` : "Balance -"}
            </div>
            <div className="wallet-chip wallet-chip--mono" title={account}>
              {shortenAddress(account)}
            </div>
          </>
        ) : (
          <button className="secondary-button" onClick={onConnect} disabled={isConnecting}>
            {isConnecting ? "Connecting..." : "Connect"}
          </button>
        )}
      </div>
    </header>
  );
}
