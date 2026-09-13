import { CheckCircle2, KeyRound, RefreshCw, ShieldCheck, Wifi, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "../components/ui";
import { ApiClientError } from "../lib/api-client";
import {
  getModelSettings,
  refreshProviderModels,
  saveModelSettings,
  testModelConnection,
  type AvailableModel,
  type ModelProviderId,
  type ModelProviderSetting,
} from "../lib/model-settings-api";

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

function keyValue(values: Partial<Record<ModelProviderId, string>>, provider: ModelProviderId): string {
  return values[provider] ?? "";
}

function modelsForSelect(models: AvailableModel[], selected: string): AvailableModel[] {
  if (!selected || models.some((item) => item.id === selected)) return models;
  return [{ id: selected, name: selected }, ...models];
}

export function ModelSettingsPanel({ accessToken, onAuthExpired }: { accessToken: string; onAuthExpired: () => void }) {
  const [providers, setProviders] = useState<ModelProviderSetting[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ModelProviderId>("anthropic");
  const [selectedModels, setSelectedModels] = useState<Partial<Record<ModelProviderId, string>>>({});
  const [apiKeys, setApiKeys] = useState<Partial<Record<ModelProviderId, string>>>({});
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const handleError = useCallback((reason: unknown, fallback: string) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      onAuthExpired();
      return;
    }
    setNotice({ tone: "error", text: reason instanceof Error ? reason.message : fallback });
  }, [onAuthExpired]);

  const applyProviders = useCallback((next: ModelProviderSetting[]) => {
    setProviders(next);
    const active = next.find((item) => item.active) ?? next[0];
    if (active) setSelectedProvider(active.id);
    setSelectedModels((current) => {
      const updated = { ...current };
      for (const provider of next) updated[provider.id] = provider.model_id ?? updated[provider.id] ?? provider.default_model;
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    void getModelSettings(accessToken)
      .then((response) => {
        applyProviders(response.data.providers);
        setStorageAvailable(response.meta.storage_available);
      })
      .catch((reason: unknown) => handleError(reason, "模型设置加载失败。"))
      .finally(() => setLoading(false));
  }, [accessToken, applyProviders, handleError]);

  const current = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? null,
    [providers, selectedProvider],
  );
  const modelId = current ? selectedModels[current.id] ?? current.model_id ?? current.default_model : "";
  const apiKey = current ? keyValue(apiKeys, current.id).trim() : "";
  const canUseCredential = apiKey ? apiKey.length >= 8 : Boolean(current?.configured);

  const selectProvider = (provider: ModelProviderSetting) => {
    setSelectedProvider(provider.id);
    setNotice(null);
  };

  const refreshModels = async () => {
    if (!current || !accessToken || refreshing || !canUseCredential) return;
    setRefreshing(true);
    setNotice({ tone: "info", text: "正在向服务商获取当前账号可用模型…" });
    try {
      const response = await refreshProviderModels(accessToken, current.id, apiKey || undefined);
      const models = response.data.models;
      const nextModelId = models.some((item) => item.id === modelId) ? modelId : (models[0]?.id ?? modelId);
      setProviders((items) => items.map((item) => item.id === current.id ? { ...item, models } : item));
      setSelectedModels((values) => ({ ...values, [current.id]: nextModelId }));
      const switched = nextModelId !== modelId ? ` 原选择已不在厂商列表中，已切换为 ${nextModelId}。` : "";
      setNotice({ tone: "success", text: `已从 ${current.short_name} 实时刷新，共发现 ${models.length} 个可用模型。${switched}` });
    } catch (reason) {
      handleError(reason, "模型列表刷新失败。");
    } finally {
      setRefreshing(false);
    }
  };

  const testConnection = async () => {
    if (!current || !accessToken || testing || !canUseCredential || !modelId) return;
    setTesting(true);
    setNotice({ tone: "info", text: "正在验证 API Key 与所选模型…" });
    try {
      await testModelConnection(accessToken, current.id, modelId, apiKey || undefined);
      setNotice({ tone: "success", text: `${current.short_name} 连接成功，所选模型可用。` });
    } catch (reason) {
      handleError(reason, "连接测试失败。");
    } finally {
      setTesting(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current || !accessToken || saving || !storageAvailable || !canUseCredential || !modelId) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await saveModelSettings(accessToken, current.id, modelId, apiKey || undefined);
      applyProviders(response.data.providers);
      setApiKeys((values) => ({ ...values, [current.id]: "" }));
      setNotice({ tone: "success", text: `${current.short_name} 已设为系统当前模型，后续任务会自动使用。` });
    } catch (reason) {
      handleError(reason, "模型设置保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="model-settings-page">
        {!storageAvailable && (
          <div className="model-settings-notice model-settings-notice--error" role="alert">
            <XCircle size={17} aria-hidden="true" />
            <span>安全存储尚未启用，请先应用数据库迁移并重启 API 服务。</span>
          </div>
        )}

        <div className="model-settings-card">
          {loading ? <div className="model-settings-loading">正在读取模型配置…</div> : (
            <form onSubmit={(event) => void save(event)}>
              <fieldset className="model-provider-fieldset">
                <legend>选择服务商</legend>
                <div className="model-provider-grid">
                  {providers.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={`model-provider-option ${selectedProvider === provider.id ? "is-selected" : ""}`}
                      onClick={() => selectProvider(provider)}
                      aria-pressed={selectedProvider === provider.id}
                    >
                      <span className={`model-provider-option__signal ${provider.configured ? "is-configured" : ""}`} aria-hidden="true" />
                      <span className="model-provider-option__monogram">{provider.short_name.slice(0, 2)}</span>
                      <span><strong>{provider.short_name}</strong><small>{provider.configured ? (provider.active ? "当前使用" : "已配置") : "未配置"}</small></span>
                      {provider.active && <CheckCircle2 className="model-provider-option__check" size={17} aria-label="当前使用" />}
                    </button>
                  ))}
                </div>
              </fieldset>

              {current && (
                <div className="model-settings-form-grid">
                  <section className="model-settings-fields">
                    <div className="model-settings-label-row">
                      <label htmlFor="model-setting-model">模型</label>
                      <button type="button" className="model-refresh" onClick={() => void refreshModels()} disabled={!canUseCredential || refreshing}>
                        <RefreshCw className={refreshing ? "spin" : ""} size={14} aria-hidden="true" />
                        {refreshing ? "刷新中" : "刷新可用模型"}
                      </button>
                    </div>
                    <select
                      id="model-setting-model"
                      value={modelId}
                      onChange={(event) => { setSelectedModels((values) => ({ ...values, [current.id]: event.target.value })); setNotice(null); }}
                    >
                      {modelsForSelect(current.models, modelId).map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                    </select>

                    <label htmlFor="model-setting-key">API Key {current.configured && <span>· 已保存指纹 {current.fingerprint}</span>}</label>
                    <div className="model-key-input">
                      <KeyRound size={17} aria-hidden="true" />
                      <input
                        id="model-setting-key"
                        type="password"
                        value={keyValue(apiKeys, current.id)}
                        onChange={(event) => { setApiKeys((values) => ({ ...values, [current.id]: event.target.value })); setNotice(null); }}
                        placeholder={current.configured ? "留空则继续使用已保存的密钥" : "输入该服务商的 API Key"}
                        autoComplete="new-password"
                        spellCheck={false}
                        minLength={8}
                        maxLength={500}
                      />
                    </div>

                    <label htmlFor="model-setting-base-url">官方接口地址</label>
                    <input id="model-setting-base-url" className="model-base-url" value={current.base_url} readOnly aria-readonly="true" />
                  </section>

                  <aside className="model-settings-summary">
                    <div className="model-settings-summary__icon"><ShieldCheck size={22} aria-hidden="true" /></div>
                    <div><span>安全策略</span><strong>服务端加密，按账号隔离</strong></div>
                    <p>API Key 不会回显、不会写入浏览器存储或任务日志。更换服务商后，原服务商密钥仍安全保留。</p>
                    <dl>
                      <div><dt>服务商</dt><dd>{current.name}</dd></div>
                      <div><dt>当前模型</dt><dd>{modelId}</dd></div>
                      <div><dt>状态</dt><dd className={current.configured ? "is-ready" : ""}>{current.configured ? "密钥已配置" : "等待配置"}</dd></div>
                    </dl>
                  </aside>
                </div>
              )}

              <div className="model-settings-notice-slot" aria-live="polite">
                {notice && (
                  <div className={`model-settings-notice model-settings-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
                    {notice.tone === "success" ? <CheckCircle2 size={17} /> : notice.tone === "error" ? <XCircle size={17} /> : <Wifi size={17} />}
                    <span>{notice.text}</span>
                  </div>
                )}
              </div>

              <div className="model-settings-actions">
                <Button type="button" tone="secondary" icon={<Wifi size={16} />} loading={testing} disabled={!canUseCredential || !modelId} onClick={() => void testConnection()}>测试连接</Button>
                <Button type="submit" loading={saving} disabled={!storageAvailable || !canUseCredential || !modelId}>保存并启用</Button>
              </div>
            </form>
          )}
        </div>
    </div>
  );
}
