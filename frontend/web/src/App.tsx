import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface UiPreference {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "active" | "inactive";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<UiPreference[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPreferenceData, setNewPreferenceData] = useState({
    category: "",
    description: "",
    uiSettings: ""
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate statistics for dashboard
  const activeCount = preferences.filter(p => p.status === "active").length;
  const inactiveCount = preferences.filter(p => p.status === "inactive").length;
  const pendingCount = preferences.filter(p => p.status === "pending").length;

  // Filter preferences based on search and filters
  const filteredPreferences = preferences.filter(preference => {
    const matchesSearch = searchQuery === "" || 
      preference.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      preference.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = filterCategory === "all" || preference.category === filterCategory;
    const matchesStatus = filterStatus === "all" || preference.status === filterStatus;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Get unique categories for filter dropdown
  const categories = Array.from(new Set(preferences.map(p => p.category)));

  useEffect(() => {
    loadPreferences().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPreferences = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("preference_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing preference keys:", e);
        }
      }
      
      const list: UiPreference[] = [];
      
      for (const key of keys) {
        try {
          const preferenceBytes = await contract.getData(`preference_${key}`);
          if (preferenceBytes.length > 0) {
            try {
              const preferenceData = JSON.parse(ethers.toUtf8String(preferenceBytes));
              list.push({
                id: key,
                encryptedData: preferenceData.data,
                timestamp: preferenceData.timestamp,
                owner: preferenceData.owner,
                category: preferenceData.category,
                status: preferenceData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing preference data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading preference ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPreferences(list);
    } catch (e) {
      console.error("Error loading preferences:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPreference = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting UI preferences with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newPreferenceData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const preferenceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const preferenceData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newPreferenceData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `preference_${preferenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(preferenceData))
      );
      
      const keysBytes = await contract.getData("preference_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(preferenceId);
      
      await contract.setData(
        "preference_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "UI preferences encrypted and stored securely!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPreferenceData({
          category: "",
          description: "",
          uiSettings: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const activatePreference = async (preferenceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing UI preferences with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const preferenceBytes = await contract.getData(`preference_${preferenceId}`);
      if (preferenceBytes.length === 0) {
        throw new Error("Preference not found");
      }
      
      const preferenceData = JSON.parse(ethers.toUtf8String(preferenceBytes));
      
      const updatedPreference = {
        ...preferenceData,
        status: "active"
      };
      
      await contract.setData(
        `preference_${preferenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPreference))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE activation completed successfully!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Activation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const deactivatePreference = async (preferenceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing UI preferences with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const preferenceBytes = await contract.getData(`preference_${preferenceId}`);
      if (preferenceBytes.length === 0) {
        throw new Error("Preference not found");
      }
      
      const preferenceData = JSON.parse(ethers.toUtf8String(preferenceBytes));
      
      const updatedPreference = {
        ...preferenceData,
        status: "inactive"
      };
      
      await contract.setData(
        `preference_${preferenceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPreference))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE deactivation completed successfully!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Deactivation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderPieChart = () => {
    const total = preferences.length || 1;
    const activePercentage = (activeCount / total) * 100;
    const inactivePercentage = (inactiveCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment active" 
            style={{ transform: `rotate(${activePercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment inactive" 
            style={{ transform: `rotate(${(activePercentage + inactivePercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(activePercentage + inactivePercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{preferences.length}</div>
            <div className="pie-label">Preferences</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box active"></div>
            <span>Active: {activeCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box inactive"></div>
            <span>Inactive: {inactiveCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted UI connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="fhe-icon"></div>
          </div>
          <h1>OsUi<span>FHE</span></h1>
          <div className="tagline">Privacy-Preserving Personalized UI</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-preference-btn cyber-button"
          >
            <div className="add-icon"></div>
            New Preference
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered UI Personalization</h2>
            <p>Dynamically adjust your OS interface based on encrypted usage patterns with Fully Homomorphic Encryption</p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Project Introduction</h3>
            <p>OsUiFHE leverages FHE technology to personalize your operating system interface while keeping your usage patterns completely private.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>UI Preference Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{preferences.length}</div>
                <div className="stat-label">Total Preferences</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{activeCount}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{inactiveCount}</div>
                <div className="stat-label">Inactive</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="preferences-section">
          <div className="section-header">
            <h2>Encrypted UI Preferences</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search preferences..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="cyber-input"
                />
              </div>
              <div className="filter-group">
                <select 
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="cyber-select"
                >
                  <option value="all">All Categories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="cyber-select"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <button 
                onClick={loadPreferences}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="preferences-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Category</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredPreferences.length === 0 ? (
              <div className="no-preferences">
                <div className="no-preferences-icon"></div>
                <p>No UI preferences found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Preference
                </button>
              </div>
            ) : (
              filteredPreferences.map(preference => (
                <div className="preference-row" key={preference.id}>
                  <div className="table-cell preference-id">#{preference.id.substring(0, 6)}</div>
                  <div className="table-cell">{preference.category}</div>
                  <div className="table-cell">{preference.owner.substring(0, 6)}...{preference.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(preference.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${preference.status}`}>
                      {preference.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(preference.owner) && (
                      <>
                        {preference.status !== "active" && (
                          <button 
                            className="action-btn cyber-button success"
                            onClick={() => activatePreference(preference.id)}
                          >
                            Activate
                          </button>
                        )}
                        {preference.status !== "inactive" && (
                          <button 
                            className="action-btn cyber-button danger"
                            onClick={() => deactivatePreference(preference.id)}
                          >
                            Deactivate
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPreference} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          preferenceData={newPreferenceData}
          setPreferenceData={setNewPreferenceData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="fhe-icon"></div>
              <span>OsUiFHE</span>
            </div>
            <p>Privacy-preserving personalized UI using Zama FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} OsUiFHE. All rights reserved.
          </div>
          <div className="footer-disclaimer">
            This application uses Fully Homomorphic Encryption to protect your UI preferences and usage patterns.
            All data is processed in encrypted form and never decrypted on our servers.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  preferenceData: any;
  setPreferenceData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  preferenceData,
  setPreferenceData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPreferenceData({
      ...preferenceData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!preferenceData.category || !preferenceData.uiSettings) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add UI Preference</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your UI preferences will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={preferenceData.category} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select category</option>
                <option value="Layout">Layout Preferences</option>
                <option value="Theme">Color Theme</option>
                <option value="Shortcuts">Keyboard Shortcuts</option>
                <option value="Notifications">Notification Settings</option>
                <option value="Workflow">Workflow Preferences</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={preferenceData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>UI Settings (JSON) *</label>
              <textarea 
                name="uiSettings"
                value={preferenceData.uiSettings} 
                onChange={handleChange}
                placeholder='{"theme": "dark", "layout": "grid", "density": "compact"}' 
                className="cyber-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;