(function () {
    'use strict';

    const form = document.getElementById('set-password-form');
    const intro = document.getElementById('password-intro');
    const status = document.getElementById('password-status');

    function setStatus(message, isError) {
        status.textContent = message || '';
        status.classList.toggle('is-error', Boolean(isError));
    }

    document.querySelectorAll('[data-password-toggle]').forEach(function (toggle) {
        const input = document.getElementById(toggle.dataset.passwordToggle);
        if (!input) {
            throw new Error('Password visibility control is missing its input.');
        }

        toggle.addEventListener('click', function () {
            const visible = input.type === 'password';
            const action = visible ? 'Hide' : 'Show';
            input.type = visible ? 'text' : 'password';
            toggle.textContent = action;
            toggle.setAttribute('aria-label', action + ' ' + input.labels[0].textContent.toLowerCase());
            toggle.setAttribute('aria-pressed', String(visible));
        });
    });

    async function initialize() {
        if (!window.MCMBackend || !window.MCMBackend.isConfigured()) {
            setStatus(
                window.MCMBackend
                    ? window.MCMBackend.configurationError()
                    : 'The Supabase client did not load. Check the network connection and try again.',
                true
            );
            return;
        }

        try {
            const result = await window.MCMBackend.getClient().auth.getUser();
            if (result.error) {
                throw result.error;
            }
            if (!result.data.user) {
                setStatus('No active invitation session was found. Open the newest invitation email link, then try again.', true);
                return;
            }

            intro.textContent = 'Choose a password with at least 8 characters for ' +
                (result.data.user.email || 'your account') + '.';
            form.hidden = false;
        } catch (error) {
            setStatus(error.message || 'Unable to verify the invitation. Open the newest email link and try again.', true);
        }
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (!form.reportValidity()) {
            return;
        }

        const password = form.elements.password.value;
        if (password !== form.elements.confirmPassword.value) {
            setStatus('The passwords do not match.', true);
            form.elements.confirmPassword.focus();
            return;
        }

        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        setStatus('Saving your password…', false);
        try {
            await window.MCMBackend.admin.setPassword(password);
            form.reset();
            setStatus('Password saved. Opening admin access…', false);
            window.setTimeout(function () {
                window.location.assign('dashboard.html');
            }, 1200);
        } catch (error) {
            setStatus(error.message || 'Unable to save the password. Try again.', true);
            submit.disabled = false;
        }
    });

    initialize();
}());
