import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import ErrorMessage from "../common/ErrorMessage";
import LoadingSpinner from "../common/LoadingSpinner";

/**
 * Only the public demo deployment sets this. Everywhere else the block below
 * is not rendered at all, so a normal build has no demo affordance to find.
 */
const DEMO_ENABLED = import.meta.env.VITE_DEMO_MODE === 'true';

function LoginForm() {
  const { login, startDemo, loading: authLoading, authError } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  // Tracked separately from authLoading so only the button that was actually
  // pressed shows a spinner.
  const [demoStarting, setDemoStarting] = useState(false);

  const handleDemo = async () => {
    setLocalError("");
    setDemoStarting(true);
    try {
      await startDemo();
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setDemoStarting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");

    if (!email || !password) {
      setLocalError("Please enter both email and password");
      return;
    }

    try {
      await login(email, password);
    } catch (error) {
      console.log("LoginForm: Submission error", error);
      setLocalError(error.message);
    }
  };

  return (
    // This container matches the main card from your HTML
    <div className="bg-slate-800 p-8 md:p-12 rounded-xl shadow-2xl w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white">Welcome Back</h1>
        <p className="text-slate-400 mt-2">Sign in to continue to your account.</p>
      </div>

      {/* Display global auth errors or local form errors */}
      {(authError || localError) && (
        <div className="mb-4">
          <ErrorMessage message={authError || localError} />
        </div>
      )}
      
      {/* The primary action on the public demo. A visitor arriving from a
          portfolio link is not going to fill in a registration form, so the
          demo gets the top of the card and the form drops to secondary. */}
      {DEMO_ENABLED && (
        <div className="mb-8">
          <button
            type="button"
            onClick={handleDemo}
            disabled={authLoading || demoStarting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition duration-150 ease-in-out transform hover:scale-105 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {demoStarting ? (
              <div className="flex items-center justify-center">
                <LoadingSpinner />
                <span className="ml-2">Setting up your demo…</span>
              </div>
            ) : (
              'Try the live demo'
            )}
          </button>
          <p className="text-xs text-slate-400 mt-3 text-center leading-relaxed">
            No sign-up. You get a guest account with three people to talk to —
            one offline, one online, one reading — so you can watch the delivery
            ticks and typing indicators behave differently for each.
          </p>

          <div className="flex items-center gap-3 mt-8" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-700" />
            <span className="text-xs uppercase tracking-wider text-slate-500">or sign in</span>
            <span className="h-px flex-1 bg-slate-700" />
          </div>
        </div>
      )}

      {/* The form element itself - action and method are handled by React's onSubmit */}
      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-6">
          <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
            Email Address
          </label>
          <input
            type="email"
            name="email"
            id="email"
            className="form-input w-full px-4 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={authLoading}
          />
        </div>

        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            {/* "Forgot password?" link - can be a <Link> to a route later */}
            <a href="#" className="text-sm text-indigo-400 hover:text-indigo-300 transition duration-150 ease-in-out">
              Forgot password?
            </a>
          </div>
          <input
            type="password"
            name="password"
            id="password"
            className="form-input w-full px-4 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out"
            placeholder="••••••••"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={authLoading}
          />
        </div>

        <div className="mb-6">
          <button
            type="submit"
            disabled={authLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition duration-150 ease-in-out transform hover:scale-105 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {authLoading ? (
              <div className="flex items-center justify-center">
                <LoadingSpinner /> {/* Using your spinner component */}
                <span className="ml-2">Signing In...</span>
              </div>
            ) : (
              'Login'
            )}
          </button>
        </div>
      </form>

      <div className="text-center">
        <p className="text-sm text-slate-400">
          Not a member yet?{' '}
          <Link to="/register" className="font-medium text-indigo-400 hover:text-indigo-300 transition duration-150 ease-in-out">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}

export default LoginForm;
