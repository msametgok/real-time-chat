import React, { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { Link } from "react-router-dom";
import ErrorMessage from "../common/ErrorMessage";
import LoadingSpinner from "../common/LoadingSpinner";

function RegisterForm() {
    const { register, loading: authLoading, authError } = useAuth();

    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState('');
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [localError, setLocalError] = useState("");

    // ** Add confirm password later **

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError("");

        if (!username || !email || !password || !confirmPassword) {
          setLocalError("Please fill in all fields");
          return;
        }
        if (password !== confirmPassword) {
            setLocalError("Passwords do not match");
            return;
        }
        if (!agreedToTerms) {
            setLocalError("You must agree to the Terms of Service to register");
            return;
        }

        try {
            await register(username, email, password);
        } catch (error) {
          console.log("Registration error:", error);
        }
    }

    return (
    <div className="bg-slate-800 p-8 md:p-12 rounded-xl shadow-2xl w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white">Create Account</h1>
        <p className="text-slate-400 mt-2">Join us and start chatting today!</p>
      </div>

      {(authError || localError) && (
        <div className="mb-4">
          <ErrorMessage message={authError || localError} />
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <div>
          <label htmlFor="username-register" className="block text-sm font-medium text-slate-300 mb-2">
            Username
          </label>
          <input
            type="text"
            name="username"
            id="username-register"
            className="form-input w-full px-4 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out"
            placeholder="yourusername"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={authLoading}
            autoComplete="username"
          />
        </div>

        <div>
          <label htmlFor="email-register" className="block text-sm font-medium text-slate-300 mb-2">
            Email Address
          </label>
          <input
            type="email"
            name="email"
            id="email-register"
            className="form-input w-full px-4 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={authLoading}
            autoComplete="email"
          />
        </div>

        <div>
          <label htmlFor="password-register" className="block text-sm font-medium text-slate-300 mb-2">
            Password
          </label>
          <input
            type="password"
            name="password"
            id="password-register"
            className="form-input w-full px-4 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out"
            placeholder="•••••••• (min. 6 characters)"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={authLoading}
            autoComplete="new-password"
          />
        </div>

        <div className="mb-6">
          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-300 mb-2">
            Confirm Password
          </label>
          <input
            type="password"
            name="confirmPassword"
            id="confirm-password"
            className="form-input w-full px-4 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out"
            placeholder="••••••••"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={authLoading}
            autoComplete="new-password"
          />
        </div>

        <div className="mb-6 flex items-center">
          <input
            type="checkbox"
            name="terms"
            id="terms"
            className="h-4 w-4 text-indigo-600 border-slate-500 rounded focus:ring-indigo-500 bg-slate-700"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            disabled={authLoading}
            required // Makes the form element itself require it, good for accessibility too
          />
          <label htmlFor="terms" className="ml-2 block text-sm text-slate-400">
            I agree to the <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-400 hover:text-indigo-300">Terms of Service</a>
          </label>
        </div>
        
        <div className="mb-6">
          <button
            type="submit"
            disabled={authLoading || !agreedToTerms}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition duration-150 ease-in-out transform hover:scale-105 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {authLoading ? (
              <div className="flex items-center justify-center">
                <LoadingSpinner />
                <span className="ml-2">Creating Account...</span>
              </div>
            ) : (
              'Create Account'
            )}
          </button>
        </div>
      </form>

      <div className="text-center mt-6">
        <p className="text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300 transition duration-150 ease-in-out">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

export default RegisterForm;