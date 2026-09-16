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
  if (/token.*expired|expired.*token|invalid.*token|otp.*expired|otp.*invalid/i.test(message)) return "验证码无效或已过期，请重新获取。";
  if (/rate limit|security purposes/i.test(message)) return "请求过于频繁，请稍后再试。";
  return message;
}

export function LoginPage() {
  const { signIn, signUp, verifySignUpOtp, resendSignUpConfirmation, configurationError } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [awaitingVerification, setAwaitingVerification] = useState(false);
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
      } else if (awaitingVerification) {
        await verifySignUpOtp(email.trim(), verificationCode.trim());
      } else {
        const result = await signUp(email.trim(), password);
        if (result.requiresEmailConfirmation) {
          setAwaitingVerification(true);
          setMessage(`验证码已发送至 ${email.trim()}，请输入邮件中的验证码完成注册。`);
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
      setVerificationCode("");
      setMessage("新的验证码已发送，请使用最新邮件中的验证码。");
    } catch (error) {
      setIsError(true);
      setMessage(getAuthMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (nextMode: "sign-in" | "sign-up") => {
    setMode(nextMode);
    setMessage(null);
    setIsError(false);
    setCanResend(false);
    setAwaitingVerification(false);
    setVerificationCode("");
  };

  const editRegistrationEmail = () => {
    setAwaitingVerification(false);
    setCanResend(false);
    setVerificationCode("");
    setMessage(null);
    setIsError(false);
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
            <button type="button" className={mode === "sign-in" ? "is-active" : ""} onClick={() => changeMode("sign-in")}>登录</button>
            <button type="button" className={mode === "sign-up" ? "is-active" : ""} onClick={() => changeMode("sign-up")}>注册</button>
          </div>
          <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" readOnly={awaitingVerification} /></label>
          {!awaitingVerification && <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>}
          {awaitingVerification && (
            <label>邮箱验证码<input className="auth-code-input" type="text" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))} required minLength={6} maxLength={8} inputMode="numeric" autoComplete="one-time-code" placeholder="请输入邮件中的验证码" /></label>
          )}
          {configurationError && <div className="form-message form-message--error" role="alert">{configurationError}</div>}
          {message && <div className={`form-message ${isError ? "form-message--error" : "form-message--success"}`} role="status">{message}</div>}
          {canResend && (
            <div className="auth-verification-actions">
              <button className="auth-resend" type="button" disabled={loading || !email.trim()} onClick={() => void resendConfirmation()}>重新发送验证码</button>
              <button className="auth-resend" type="button" disabled={loading} onClick={editRegistrationEmail}>修改邮箱</button>
            </div>
          )}
          <Button type="submit" loading={loading} disabled={Boolean(configurationError) || (awaitingVerification && verificationCode.length < 6)}>{mode === "sign-in" ? "登录" : awaitingVerification ? "验证并完成注册" : "获取邮箱验证码"}</Button>
          <small>登录即表示同意《服务条款》和《隐私政策》</small>
        </form>
      </section>
    </main>
  );
}
