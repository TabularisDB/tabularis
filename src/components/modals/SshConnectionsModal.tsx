import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Plus,
  Edit2,
  Trash2,
  Check,
  Loader2,
  Zap,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  loadSshConnections,
  saveSshConnection,
  updateSshConnection,
  deleteSshConnection,
  testSshConnection,
  validateSshConnection,
  type SshConnection,
} from "../../utils/ssh";
import { toErrorMessage } from "../../utils/errors";
import { Modal } from "../ui/Modal";
import clsx from "clsx";

interface SshConnectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InputClass =
  "w-full px-3 pt-2 pb-1 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none leading-tight";
const LabelClass = "block text-xs uppercase font-bold text-muted";

interface SshInputProps {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: React.ReactNode;
}

function SshInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  error,
}: SshInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="flex flex-col">
      <label className={LabelClass}>{label}</label>
      <div className="relative group">
        <input
          type={isPassword ? (showPassword ? "text" : "password") : type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={clsx(InputClass, isPassword && "pr-10")}
          placeholder={placeholder}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors focus:outline-none"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {error}
    </div>
  );
}

export function SshConnectionsModal({
  isOpen,
  onClose,
}: SshConnectionsModalProps) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<SshConnection>>({
    port: 22,
    auth_type: "password",
    save_in_keychain: true,
  });
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");
  const [testingConnectionId, setTestingConnectionId] = useState<string | null>(
    null,
  );
  const [testResults, setTestResults] = useState<
    Record<string, "success" | "error">
  >({});
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [passphraseDirty, setPassphraseDirty] = useState(false);

  const loadConnections = useCallback(async () => {
    const result = await loadSshConnections();
    setConnections(result);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const fetchConnections = async () => {
      const result = await loadSshConnections();
      if (!cancelled) {
        setConnections(result);
      }
    };

    fetchConnections();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const updateField = (
    field: keyof SshConnection,
    value: SshConnection[keyof SshConnection],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      port: 22,
      auth_type: "password",
      save_in_keychain: true,
    });
    setEditingId(null);
    setIsCreating(false);
    setTestStatus("idle");
    setTestMessage("");
    setPasswordDirty(false);
    setPassphraseDirty(false);
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMessage("");

    try {
      // If editing and password wasn't modified, don't send empty password
      // so backend will retrieve it from keychain
      const testData: Partial<SshConnection> = { ...formData };

      // Ensure connection_id is set when editing
      if (editingId) {
        testData.id = editingId;
      }

      if (editingId && testData.auth_type === "password") {
        if (!passwordDirty) {
          // Don't send password - backend will use keychain
          delete testData.password;
        } else if (!testData.password) {
          // Password is dirty but empty/undefined - send empty string to force test with it
          testData.password = "";
        }
      }

      if (editingId && testData.auth_type === "ssh_key") {
        if (!passphraseDirty) {
          // Don't send passphrase - backend will use keychain
          delete testData.key_passphrase;
        } else if (!testData.key_passphrase) {
          // Passphrase is dirty but empty/undefined - send empty string to force test with it
          testData.key_passphrase = "";
        }
      }

      const result = await testSshConnection(testData);
      setTestStatus("success");
      setTestMessage(result);
    } catch (error) {
      console.error("SSH test failed:", error);
      setTestStatus("error");
      setTestMessage(toErrorMessage(error));
    }
  };

  const handleSave = async () => {
    try {
      // Validate connection
      const validation = validateSshConnection(formData, {
        allowEmptyPassword:
          !!editingId && !passwordDirty && !formData.password?.trim(),
      });
      if (!validation.isValid) {
        setTestStatus("error");
        setTestMessage(validation.error || t("sshConnections.fillRequired"));
        return;
      }

      const sshData: Partial<SshConnection> = {
        host: formData.host,
        port: formData.port || 22,
        user: formData.user,
        auth_type: formData.auth_type,
        password: formData.password,
        key_file: formData.key_file,
        key_passphrase: formData.key_passphrase,
        save_in_keychain: formData.save_in_keychain,
      };

      if (editingId) {
        // Apply same logic as handleTest: only delete password if not dirty
        if (sshData.auth_type === "password") {
          if (!passwordDirty) {
            delete sshData.password;
          } else if (!sshData.password) {
            sshData.password = "";
          }
        }
        if (sshData.auth_type === "ssh_key") {
          if (!passphraseDirty) {
            delete sshData.key_passphrase;
          } else if (!sshData.key_passphrase) {
            sshData.key_passphrase = "";
          }
        }
        await updateSshConnection(editingId, formData.name!, sshData);
      } else {
        await saveSshConnection(formData.name!, sshData);
      }

      await loadConnections();
      resetForm();
    } catch (error) {
      console.error("Failed to save SSH connection:", error);
      setTestStatus("error");
      setTestMessage(t("sshConnections.failSave"));
    }
  };

  const handleEdit = (conn: SshConnection) => {
    // Determine auth_type for backward compatibility
    const auth_type =
      conn.auth_type ||
      (conn.key_file && conn.key_file.trim() !== "" ? "ssh_key" : "password");

    setFormData({
      ...conn,
      auth_type,
    });
    setPasswordDirty(false);
    setPassphraseDirty(false);
    setEditingId(conn.id);
    setIsCreating(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("sshConnections.confirmDelete"))) {
      return;
    }

    try {
      await deleteSshConnection(id);
      await loadConnections();
    } catch (error) {
      console.error("Failed to delete SSH connection:", error);
      setTestStatus("error");
      setTestMessage(`${t("sshConnections.failDelete")}: ${toErrorMessage(error)}`);
    }
  };

  const handleQuickTest = async (conn: SshConnection) => {
    setTestingConnectionId(conn.id);

    try {
      await testSshConnection(conn);
      // Test successful - show success feedback
      setTestResults((prev) => ({ ...prev, [conn.id]: "success" }));
      console.log(`Connection test successful for ${conn.name}`);

      // Clear the success indicator after 3 seconds
      setTimeout(() => {
        setTestResults((prev) => {
          const updated = { ...prev };
          delete updated[conn.id];
          return updated;
        });
      }, 3000);
    } catch (error) {
      console.error("SSH quick test failed:", error);

      // Show error feedback
      setTestResults((prev) => ({ ...prev, [conn.id]: "error" }));
      setTestStatus("error");
      setTestMessage(`${t("sshConnections.testFailed")}: ${toErrorMessage(error)}`);

      // Clear the error indicator after 3 seconds
      setTimeout(() => {
        setTestResults((prev) => {
          const updated = { ...prev };
          delete updated[conn.id];
          return updated;
        });
      }, 3000);
    } finally {
      setTestingConnectionId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] backdrop-blur-sm">
      <div className="bg-base border border-strong rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-strong bg-elevated">
          <h2 className="text-xl font-bold text-primary flex items-center gap-2">
            {t("sshConnections.title")}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isCreating ? (
            <>
              <div className="mb-4">
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Plus size={16} />
                  {t("sshConnections.createNew")}
                </button>
              </div>

              <div className="space-y-2">
                {connections.length === 0 ? (
                  <div className="text-center py-8 text-muted">
                    {t("sshConnections.noConnections")}
                  </div>
                ) : (
                  connections.map((conn) => (
                    <div
                      key={conn.id}
                      className="flex items-center justify-between p-4 bg-elevated border border-strong rounded-lg hover:border-blue-500 transition-colors"
                    >
                      <div>
                        <div className="font-semibold text-primary">
                          {conn.name}
                        </div>
                        <div className="text-sm text-muted">
                          {conn.user}@{conn.host}:{conn.port}
                        </div>
                        {conn.key_file && (
                          <div className="text-xs text-muted mt-1">
                            {t("sshConnections.keyFile")}: {conn.key_file}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleQuickTest(conn)}
                          disabled={testingConnectionId === conn.id}
                          className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                            testResults[conn.id] === "success"
                              ? "text-green-500 bg-green-500/20"
                              : testResults[conn.id] === "error"
                                ? "text-red-500 bg-red-500/20"
                                : "text-green-500 hover:bg-green-500/10"
                          }`}
                          title={t("sshConnections.quickTest")}
                        >
                          {testingConnectionId === conn.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : testResults[conn.id] === "success" ? (
                            <Check size={16} />
                          ) : testResults[conn.id] === "error" ? (
                            <XCircle size={16} />
                          ) : (
                            <Zap size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(conn)}
                          className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors"
                          title={t("sshConnections.edit")}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(conn.id)}
                          className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                          title={t("sshConnections.delete")}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <SshInput
                label={t("sshConnections.name")}
                value={formData.name}
                onChange={(val) => updateField("name", val)}
                placeholder={t("sshConnections.namePlaceholder")}
              />

              <div className="grid grid-cols-2 gap-4">
                <SshInput
                  label={t("newConnection.sshHost")}
                  value={formData.host}
                  onChange={(val) => updateField("host", val)}
                  placeholder="example.com"
                />
                <SshInput
                  label={t("newConnection.sshPort")}
                  value={formData.port}
                  onChange={(val) => updateField("port", parseInt(val) || 22)}
                  type="number"
                  placeholder="22"
                />
              </div>

              <SshInput
                label={t("newConnection.sshUser")}
                value={formData.user}
                onChange={(val) => updateField("user", val)}
                placeholder="username"
              />

              <div className="flex flex-col">
                <label className={LabelClass}>
                  {t("sshConnections.authType")}
                </label>
                <select
                  value={formData.auth_type || "password"}
                  onChange={(e) =>
                    updateField(
                      "auth_type",
                      e.target.value as "password" | "ssh_key",
                    )
                  }
                  className={InputClass}
                >
                  <option value="password">
                    {t("sshConnections.authTypePassword")}
                  </option>
                  <option value="ssh_key">
                    {t("sshConnections.authTypeSshKey")}
                  </option>
                </select>
              </div>

              {formData.auth_type === "password" && (
                <div className="flex flex-col">
                  <SshInput
                    label={t("newConnection.sshPassword")}
                    value={formData.password}
                    onChange={(val) => {
                      setPasswordDirty(true);
                      updateField("password", val);
                    }}
                    type="password"
                    placeholder={
                      editingId && !passwordDirty && !formData.password
                        ? "<hidden>"
                        : t("newConnection.sshPasswordPlaceholder")
                    }
                  />
                  {editingId && !passwordDirty && formData.save_in_keychain && (
                    <span className="text-xs text-muted mt-1">
                      {t("sshConnections.savedInKeychain")}
                    </span>
                  )}
                </div>
              )}

              {formData.auth_type === "ssh_key" && (
                <>
                  <SshInput
                    label={t("newConnection.sshKeyFile")}
                    value={formData.key_file}
                    onChange={(val) => updateField("key_file", val)}
                    placeholder={t("newConnection.sshKeyFilePlaceholder")}
                  />

                  <div className="flex flex-col">
                    <SshInput
                      label={t("newConnection.sshKeyPassphrase")}
                      value={formData.key_passphrase}
                      onChange={(val) => {
                        setPassphraseDirty(true);
                        updateField("key_passphrase", val);
                      }}
                      type="password"
                      placeholder={
                        editingId &&
                        !passphraseDirty &&
                        !formData.key_passphrase
                          ? "<hidden>"
                          : t("newConnection.sshKeyPassphrasePlaceholder")
                      }
                    />
                    {editingId &&
                      !passphraseDirty &&
                      formData.save_in_keychain && (
                        <span className="text-xs text-muted mt-1">
                          {t("sshConnections.savedInKeychain")}
                        </span>
                      )}
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ssh-keychain-toggle"
                  checked={!!formData.save_in_keychain}
                  onChange={(e) => {
                    setPasswordDirty(true);
                    setPassphraseDirty(true);
                    updateField("save_in_keychain", e.target.checked);
                    // If password/passphrase is undefined/empty, set to empty string so it gets sent
                    if (formData.auth_type === "password" && !formData.password) {
                      updateField("password", "");
                    }
                    if (formData.auth_type === "ssh_key" && !formData.key_passphrase) {
                      updateField("key_passphrase", "");
                    }
                  }}
                  className="accent-blue-500 w-4 h-4 rounded cursor-pointer"
                />
                <label
                  htmlFor="ssh-keychain-toggle"
                  className="text-sm font-medium text-secondary cursor-pointer select-none"
                >
                  {t("newConnection.saveKeychain")}
                </label>
              </div>

              {/* Test Button and Status */}
              <div className="pt-4 border-t border-strong">
                <button
                  onClick={handleTest}
                  disabled={testStatus === "testing"}
                  className="w-full px-4 py-2 border border-strong rounded-lg hover:bg-elevated transition-colors text-secondary flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {testStatus === "testing" && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  {t("newConnection.testConnection")}
                </button>

                {testMessage && (
                  <div
                    className={`mt-3 p-3 rounded-lg flex items-start gap-2 text-sm border ${
                      testStatus === "success"
                        ? "bg-green-900/20 text-green-400 border-green-900/50"
                        : "bg-red-900/20 text-red-400 border-red-900/50"
                    }`}
                  >
                    {testStatus === "success" ? (
                      <Check size={16} className="mt-0.5" />
                    ) : (
                      <X size={16} className="mt-0.5" />
                    )}
                    <span>{testMessage}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={resetForm}
                  className="flex-1 px-4 py-2 border border-strong rounded-lg hover:bg-elevated transition-colors text-secondary"
                >
                  {t("sshConnections.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Check size={16} />
                  {editingId
                    ? t("sshConnections.update")
                    : t("sshConnections.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
