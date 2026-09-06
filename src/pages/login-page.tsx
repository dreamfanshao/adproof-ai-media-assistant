import { useState, type FormEvent } from "react";
import { Brand } from "../components/app-shell";
import { Button } from "../components/ui";
import { useAuth } from "../state/auth-context";

function getAuthMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "认证请求失败，请稍后重试。";
  if (/failed to fetch|network|fetch failed|connection|tls|timeout/i.test(message)) {
    return "暂时无法连接登录服务，请检查网络后刷新页面重试。";
  }
  if (message.includes("Invalid login credentials")) return "邮箱或密码不正确。";
  if (message.includes("Email not confirmed")) return "邮箱尚未验证，请先完成邮件确认。";
  if (message.includes("User already registered")) return "该邮箱已经注册，请直接登录。";
  if (message.includes("Password should be")) return "密码强度不足，请至少使用 8 位字符。";
  return message;
}

export function LoginPage() {
  const { signIn, signUp, resendSignUpConfirmation, configurationError } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [canResend, setCanResend] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setIsError(false);
    setCanResend(false);
    setLoading(true);
    try {
      if (mode === "sign-in") {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp(email.trim(), password);
        if (result.requiresEmailConfirmation) {
          setMessage("注册成功，请打开验证邮件完成确认后再登录。");
          setCanResend(true);
        }
      }
    } catch (error) {
      setIsError(true);
      setMessage(getAuthMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    setLoading(true);
    setIsError(false);
    try {
      await resendSignUpConfirmation(email.trim());
      setMessage("新的验证邮件已发送，请使用最新邮件中的链接。");
    } catch (error) {
      setIsError(true);
      setMessage(getAuthMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="login-card">
        <div className="login-brand-panel">
          <Brand inverse />
          <div className="login-brand-panel__copy">
            <h1>更快找到合适素人，<br />更稳完成内容审核</h1>
            <p>面向媒介专员的素人筛选与图文内容辅助审核工作台。<br />用一句话检索达人，用知识库守住合规底线。</p>
            <ul>
              <li>自然语言检索小红书素人达人</li>
              <li>证据化匹配与人工最终确认</li>
              <li>广告法与企业私有规则辅助审核</li>
            </ul>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <header>
            <h2>{mode === "sign-in" ? "登录媒介助手" : "注册媒介助手"}</h2>
            <p>使用工作邮箱进入你的个人项目工作台</p>
          </header>
          <div className="auth-mode" role="tablist" aria-label="账号操作">
            <button type="button" className={mode === "sign-in" ? "is-active" : ""} onClick={() => { setMode("sign-in"); setMessage(null); }}>登录</button>
            <button type="button" className={mode === "sign-up" ? "is-active" : ""} onClick={() => { setMode("sign-up"); setMessage(null); }}>注册</button>
          </div>
          <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
          {configurationError && <div className="form-message form-message--error" role="alert">{configurationError}</div>}
          {message && <div className={`form-message ${isError ? "form-message--error" : "form-message--success"}`} role="status">{message}</div>}
          {canResend && <button className="auth-resend" type="button" disabled={loading || !email.trim()} onClick={() => void resendConfirmation()}>重新发送验证邮件</button>}
          <Button type="submit" loading={loading} disabled={Boolean(configurationError)}>{mode === "sign-in" ? "登录" : "创建账号"}</Button>
          <small>登录即表示同意《服务条款》和《隐私政策》</small>
        </form>
      </section>
    </main>
  );
}
