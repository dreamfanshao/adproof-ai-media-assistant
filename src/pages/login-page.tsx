import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
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
  if (message.includes("两次输入的密码不一致")) return "两次输入的密码不一致，请重新确认。";
  if (/token.*expired|expired.*token|invalid.*token|otp.*expired|otp.*invalid/i.test(message)) return "验证码无效或已过期，请重新获取。";
  if (/rate limit|security purposes/i.test(message)) return "请求过于频繁，请稍后再试。";
  return message;
}

export function LoginPage() {
  const { signIn, signUp, verifySignUpOtp, resendSignUpConfirmation, configurationError } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (resendCountdown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendCountdown((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setIsError(false);
    setLoading(true);
    try {
      if (mode === "sign-in") {
        await signIn(email.trim(), password);
      } else if (awaitingVerification) {
        await verifySignUpOtp(email.trim(), verificationCode.trim());
      } else {
        setIsError(true);
        setMessage("请先点击上方“获取验证码”，再输入邮箱验证码完成注册。");
      }
    } catch (error) {
      setIsError(true);
      setMessage(getAuthMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const requestVerificationCode = async () => {
    if (!email.trim()) {
      throw new Error("请输入邮箱。");
    }
    if (!email.includes("@")) {
      throw new Error("请输入有效的邮箱地址。");
    }
    if (!password) {
      throw new Error("请输入密码。");
    }
    if (!confirmPassword) {
      throw new Error("请确认密码。");
    }
    if (password !== confirmPassword) {
      throw new Error("两次输入的密码不一致，请重新确认。");
    }
    const result = await signUp(email.trim(), password);
    if (result.requiresEmailConfirmation) {
      setAwaitingVerification(true);
      setResendCountdown(60);
      setMessage(`验证码已发送至 ${email.trim()}，请输入邮件中的验证码完成注册。`);
    }
  };

  const sendVerificationCode = async () => {
    setLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      await requestVerificationCode();
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
      setResendCountdown(60);
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
    setAwaitingVerification(false);
    setVerificationCode("");
    setConfirmPassword("");
    setResendCountdown(0);
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const editRegistrationEmail = () => {
    setAwaitingVerification(false);
    setVerificationCode("");
    setResendCountdown(0);
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
          <label className="auth-field">
            <span>邮箱</span>
            <div className="auth-field__control">
              <Mail size={19} aria-hidden="true" />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" readOnly={mode === "sign-up" && awaitingVerification} placeholder="you@email.com" />
            </div>
          </label>
          {mode === "sign-up" && (
            <div className="auth-verification-field">
              <div className="auth-code-heading">
                <label className="auth-field auth-field--code">
                  <span>邮箱验证码 <em>（验证码有效期 5 分钟，60 秒内不可重复发送）</em></span>
                  <div className="auth-code-row">
                    <div className="auth-field__control auth-code-control">
                      <ShieldCheck size={19} aria-hidden="true" />
                      <input className="auth-code-input" type="text" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))} required={awaitingVerification} minLength={6} maxLength={8} inputMode="numeric" autoComplete="one-time-code" placeholder="请输入验证码" disabled={!awaitingVerification} />
                    </div>
                    <button className="auth-code-button" type="button" disabled={loading || resendCountdown > 0} onClick={() => void (awaitingVerification ? resendConfirmation() : sendVerificationCode())}>
                      {resendCountdown > 0 ? `${resendCountdown}s 后重发` : awaitingVerification ? "重新获取" : "获取验证码"}
                    </button>
                  </div>
                </label>
                <button className="auth-helper-link" type="button" disabled={!awaitingVerification || loading || resendCountdown > 0} onClick={() => void resendConfirmation()}>
                  收不到验证码？
                </button>
              </div>
            </div>
          )}
          <label className="auth-field">
            <span>密码</span>
            <div className="auth-field__control">
              <LockKeyhole size={19} aria-hidden="true" />
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} placeholder="请输入至少 8 位密码" />
              <button className="auth-field__toggle" type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((visible) => !visible)}>
                {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
              </button>
            </div>
          </label>
          {mode === "sign-up" && (
            <label className="auth-field">
              <span>确认密码</span>
              <div className="auth-field__control">
                <LockKeyhole size={19} aria-hidden="true" />
                <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} autoComplete="new-password" placeholder="请再次输入密码" />
                <button className="auth-field__toggle" type="button" aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"} onClick={() => setShowConfirmPassword((visible) => !visible)}>
                  {showConfirmPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                </button>
              </div>
            </label>
          )}
          {configurationError && <div className="form-message form-message--error" role="alert">{configurationError}</div>}
          {message && <div className={`form-message ${isError ? "form-message--error" : "form-message--success"}`} role="status">{message}</div>}
          {mode === "sign-up" && awaitingVerification && <button className="auth-resend" type="button" disabled={loading} onClick={editRegistrationEmail}>修改邮箱</button>}
          <Button type="submit" loading={loading} disabled={Boolean(configurationError)}>{mode === "sign-in" ? "登录" : "注册"}</Button>
          <small>登录即表示同意《服务条款》和《隐私政策》</small>
        </form>
      </section>
    </main>
  );
}
