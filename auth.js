// Authentication state management
let currentUser = null;
let authCheckComplete = false;

// Show redirecting screen
function showRedirectingScreen() {
  const redirectingScreen = document.getElementById('redirecting-screen');
  const loginScreen = document.getElementById('login-screen');
  const appScreen = document.getElementById('app-screen');
  
  if (redirectingScreen) redirectingScreen.classList.remove('hidden');
  if (loginScreen) loginScreen.classList.add('hidden');
  if (appScreen) appScreen.classList.add('hidden');
}

// Hide redirecting screen
function hideRedirectingScreen() {
  const redirectingScreen = document.getElementById('redirecting-screen');
  if (redirectingScreen) redirectingScreen.classList.add('hidden');
}

// Check for stored token in localStorage
function hasStoredToken() {
  try {
    // Firebase stores auth tokens in localStorage with keys like "firebase:authUser:{API_KEY}:{PROJECT_ID}"
    const keys = Object.keys(localStorage);
    const firebaseAuthKeys = keys.filter(key => key.startsWith('firebase:authUser:'));
    return firebaseAuthKeys.length > 0;
  } catch (error) {
    // logger might not be available yet, use console as fallback
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('Error checking stored token', error);
    } else {
      console.error('Error checking stored token', error);
    }
    return false;
  }
}

// Initialize auth check
function initAuthCheck() {
  // Show redirecting screen first
  showRedirectingScreen();
  
  // Check if there's a stored token
  const hasToken = hasStoredToken();
  
  if (hasToken) {
    if (typeof logger !== 'undefined' && logger.debug) {
      logger.debug('Stored token found, waiting for auth state change');
    }
    // Wait a bit for Firebase to restore the session
    setTimeout(() => {
      if (!authCheckComplete) {
        // If still not authenticated after timeout, show login
        if (typeof logger !== 'undefined' && logger.info) {
          logger.info('Token found but authentication not restored, showing login');
        }
        hideRedirectingScreen();
        showLoginScreen();
      }
    }, 2000); // 2 second timeout
  } else {
    if (typeof logger !== 'undefined' && logger.debug) {
      logger.debug('No stored token found, showing login immediately');
    }
    // No token, show login immediately
    setTimeout(() => {
      hideRedirectingScreen();
      showLoginScreen();
    }, 300); // Small delay for smooth transition
  }
}

// Listen for auth state changes using NRD Data Access
nrd.auth.onAuthStateChanged((user) => {
  try {
    authCheckComplete = true;
    currentUser = user;
    
    // Hide redirecting screen
    hideRedirectingScreen();
    
    if (user) {
      logger.info('User authenticated, showing app screen', { uid: user.uid, email: user.email });
      showAppScreen();
    } else {
      logger.info('User not authenticated, showing login screen');
      showLoginScreen();
    }
  } catch (error) {
    logger.error('Error in auth state change', error);
    hideRedirectingScreen();
    // Fallback: show login screen
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app-screen');
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (appScreen) appScreen.classList.add('hidden');
  }
});

// Initialize auth check when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthCheck);
} else {
  initAuthCheck();
}

// Show login screen
function showLoginScreen() {
  logger.debug('Showing login screen');
  try {
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app-screen');
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (appScreen) appScreen.classList.add('hidden');
  } catch (error) {
    logger.error('Error showing login screen', error);
  }
}

// Show app screen
function showAppScreen() {
  logger.debug('Showing app screen');
  try {
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app-screen');
    if (loginScreen) loginScreen.classList.add('hidden');
    if (appScreen) appScreen.classList.remove('hidden');
  } catch (error) {
    logger.error('Error showing app screen', error);
  }
}

// Login form handler
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('login-email')?.value;
      const password = document.getElementById('login-password')?.value;
      const errorDiv = document.getElementById('login-error');

      if (!email || !password) {
        logger.warn('Login attempt with empty fields');
        if (errorDiv) errorDiv.textContent = 'Por favor complete todos los campos';
        return;
      }

      logger.info('Attempting user login', { email });
      if (errorDiv) errorDiv.textContent = '';
      showSpinner('Iniciando sesión...');

      const userCredential = await nrd.auth.signIn(email, password);
      const user = userCredential.user;
      logger.audit('USER_LOGIN', { email, uid: user.uid, timestamp: Date.now() });
      logger.info('User login successful', { uid: user.uid, email });
      hideSpinner();
    } catch (error) {
      hideSpinner();
      logger.error('Login failed', error);
      const errorDiv = document.getElementById('login-error');
      if (errorDiv) {
        errorDiv.textContent = error.message || 'Error al iniciar sesión';
      }
    }
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show profile modal
function showProfileModal() {
  logger.debug('Showing profile modal');
  const modal = document.getElementById('profile-modal');
  const content = document.getElementById('profile-modal-content');
  
  if (!modal || !content) {
    logger.warn('Profile modal elements not found');
    return;
  }
  
  const user = getCurrentUser();
  if (!user) {
    logger.warn('No user found when showing profile modal');
    return;
  }
  
  logger.debug('Displaying user profile data', { uid: user.uid, email: user.email });
  
  // Display user data
  let userDataHtml = `
    <div class="space-y-3 sm:space-y-4">
      <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200">
        <span class="text-gray-600 font-light text-sm sm:text-base">Email:</span>
        <span class="font-light text-sm sm:text-base">${escapeHtml(user.email || 'N/A')}</span>
      </div>
      ${user.displayName ? `
      <div class="flex justify-between py-2 sm:py-3 border-b border-gray-200">
        <span class="text-gray-600 font-light text-sm sm:text-base">Nombre:</span>
        <span class="font-light text-sm sm:text-base">${escapeHtml(user.displayName)}</span>
      </div>
      ` : ''}
    </div>
  `;
  
  content.innerHTML = userDataHtml;
  modal.classList.remove('hidden');
  logger.debug('Profile modal shown');
}

// Close profile modal
function closeProfileModal() {
  logger.debug('Closing profile modal');
  const modal = document.getElementById('profile-modal');
  if (modal) {
    modal.classList.add('hidden');
    logger.debug('Profile modal closed');
  }
}

// Profile button handler
const profileBtn = document.getElementById('profile-btn');
if (profileBtn) {
  profileBtn.addEventListener('click', () => {
    showProfileModal();
  });
}

// Close profile modal button
const closeProfileModalBtn = document.getElementById('close-profile-modal');
if (closeProfileModalBtn) {
  closeProfileModalBtn.addEventListener('click', () => {
    closeProfileModal();
  });
}

// Logout handler (from profile modal)
const profileLogoutBtn = document.getElementById('profile-logout-btn');
if (profileLogoutBtn) {
  profileLogoutBtn.addEventListener('click', async () => {
    try {
      const user = getCurrentUser();
      logger.info('Attempting user logout', { uid: user?.uid, email: user?.email });
      closeProfileModal();
      showSpinner('Cerrando sesión...');
      await nrd.auth.signOut();
      logger.audit('USER_LOGOUT', { uid: user?.uid, email: user?.email, timestamp: Date.now() });
      logger.info('User logout successful');
      hideSpinner();
    } catch (error) {
      hideSpinner();
      logger.error('Logout failed', error);
    }
  });
}

// Get current user
function getCurrentUser() {
  // Use NRD Data Access to get current user, fallback to local variable
  return nrd.auth.getCurrentUser() || currentUser;
}

