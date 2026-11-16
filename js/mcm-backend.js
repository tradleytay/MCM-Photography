(function (global) {
    'use strict';

    const config = global.MCM_BACKEND_CONFIG || {};
    const parentAccessKey = 'mcm-parent-access-token';
    const adminTables = Object.freeze({
        schools: 'schools',
        projects: 'school_projects',
        classes: 'school_classes',
        learners: 'learners',
        photos: 'school_photos',
        packages: 'packages',
        content: 'site_content',
        bookings: 'bookings',
        orders: 'parent_orders',
        orderItems: 'parent_order_items',
        audit: 'admin_audit_log'
    });
    let client;

    function configurationError() {
        if (typeof config.supabaseUrl !== 'string' || !config.supabaseUrl.trim()) {
            return 'The Supabase project URL is missing from js/backend-config.js.';
        }
        if (typeof config.supabasePublishableKey !== 'string' || !config.supabasePublishableKey.trim()) {
            return 'The Supabase publishable key is missing from js/backend-config.js.';
        }

        try {
            const url = new URL(config.supabaseUrl);
            if (url.protocol !== 'https:' &&
                !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
                return 'The Supabase project URL must use HTTPS (HTTP is allowed only for localhost development).';
            }
        } catch (error) {
            return 'The Supabase project URL in js/backend-config.js is invalid.';
        }
        return null;
    }

    function isConfigured() {
        return configurationError() === null;
    }

    function isReady() {
        return isConfigured() && config.backendReady === true;
    }

    function readinessMessage() {
        if (!isConfigured()) {
            return configurationError();
        }
        return isReady()
            ? null
            : 'Supabase is configured, but its schema and Edge Functions have not been deployed and enabled.';
    }

    function getClient() {
        const configError = configurationError();
        if (configError) {
            throw new Error(configError);
        }
        if (!global.supabase || typeof global.supabase.createClient !== 'function') {
            throw new Error('The Supabase client library did not load. Check the network connection and CDN availability.');
        }
        if (!client) {
            client = global.supabase.createClient(config.supabaseUrl.trim(), config.supabasePublishableKey.trim(), {
                auth: {
                    storage: global.sessionStorage,
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
        }
        return client;
    }

    function raise(error, fallback) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(error && error.message ? error.message : fallback);
    }

    async function invoke(functionName, body) {
        const result = await getClient().functions.invoke(functionName, { body: body || {} });
        if (result.error) {
            raise(result.error, 'The Supabase function "' + functionName + '" failed.');
        }
        return result.data;
    }

    async function requireAdminUser() {
        const result = await getClient().auth.getUser();
        if (result.error) {
            raise(result.error, 'Unable to verify the administrator session.');
        }
        if (!result.data.user) {
            throw new Error('Sign in with an administrator account to continue.');
        }
        if (!result.data.user.app_metadata || result.data.user.app_metadata.role !== 'admin') {
            const signOut = await getClient().auth.signOut();
            if (signOut.error) {
                raise(signOut.error, 'The account is not an administrator and could not be signed out.');
            }
            throw new Error('This account does not have the administrator role.');
        }
        return result.data.user;
    }

    async function getAdminSessionUser() {
        const result = await getClient().auth.getUser();
        if (result.error) {
            raise(result.error, 'Unable to verify the administrator session.');
        }
        if (!result.data.user) {
            return null;
        }
        if (!result.data.user.app_metadata || result.data.user.app_metadata.role !== 'admin') {
            const signOut = await getClient().auth.signOut();
            if (signOut.error) {
                raise(signOut.error, 'The account is not an administrator and could not be signed out.');
            }
            throw new Error('This account does not have the administrator role.');
        }
        return result.data.user;
    }

    function tableName(name) {
        if (!Object.prototype.hasOwnProperty.call(adminTables, name)) {
            throw new Error('Unknown admin data collection: ' + name);
        }
        return adminTables[name];
    }

    async function adminSignIn(email, password) {
        const result = await getClient().auth.signInWithPassword({ email: email, password: password });
        if (result.error) {
            raise(result.error, 'Administrator sign-in failed.');
        }
        if (!result.data.user.app_metadata || result.data.user.app_metadata.role !== 'admin') {
            const signOut = await getClient().auth.signOut();
            if (signOut.error) {
                raise(signOut.error, 'The account is not an administrator and could not be signed out.');
            }
            throw new Error('This account does not have the administrator role.');
        }
        return result.data.user;
    }

    const admin = Object.freeze({
        signIn: adminSignIn,
        setPassword: async function (password) {
            const result = await getClient().auth.updateUser({ password: password });
            if (result.error) {
                raise(result.error, 'Unable to set the administrator password.');
            }
            return result.data.user;
        },
        signOut: async function () {
            const result = await getClient().auth.signOut();
            if (result.error) {
                raise(result.error, 'Administrator sign-out failed.');
            }
        },
        currentUser: requireAdminUser,
        sessionUser: getAdminSessionUser,
        list: async function (collection) {
            await requireAdminUser();
            const result = await getClient().from(tableName(collection)).select('*');
            if (result.error) {
                raise(result.error, 'Unable to load ' + collection + '.');
            }
            return result.data;
        },
        create: async function (collection, record) {
            await requireAdminUser();
            const result = await getClient().from(tableName(collection)).insert(record).select().single();
            if (result.error) {
                raise(result.error, 'Unable to create a ' + collection + ' record.');
            }
            return result.data;
        },
        update: async function (collection, id, changes) {
            await requireAdminUser();
            const result = await getClient().from(tableName(collection)).update(changes).eq('id', id).select().single();
            if (result.error) {
                raise(result.error, 'Unable to update the ' + collection + ' record.');
            }
            return result.data;
        },
        remove: async function (collection, id) {
            await requireAdminUser();
            const result = await getClient().from(tableName(collection)).delete().eq('id', id);
            if (result.error) {
                raise(result.error, 'Unable to delete the ' + collection + ' record.');
            }
        },
        createOrder: async function (learnerId, photoIds, packageIds, adminNotes) {
            await requireAdminUser();
            const result = await getClient().rpc('create_admin_order', {
                p_learner_id: learnerId,
                p_photo_ids: photoIds,
                p_package_ids: packageIds,
                p_admin_notes: adminNotes || ''
            });
            if (result.error) {
                raise(result.error, 'Unable to create the order record.');
            }
            if (!Array.isArray(result.data) || !result.data[0]) {
                throw new Error('The new order could not be confirmed.');
            }
            return result.data[0];
        },
        setLearnerPin: async function (learnerId, pin) {
            await requireAdminUser();
            return invoke('admin-set-learner-pin', { learnerId: learnerId, pin: pin });
        }
    });

    const parent = Object.freeze({
        access: async function (reference, pin) {
            const result = await invoke('parent-access', { reference: reference, pin: pin });
            if (!result || typeof result.accessToken !== 'string' || !result.accessToken) {
                throw new Error('The parent-access function returned an invalid response.');
            }
            global.sessionStorage.setItem(parentAccessKey, result.accessToken);
            return result;
        },
        gallery: async function () {
            const accessToken = global.sessionStorage.getItem(parentAccessKey);
            if (!accessToken) {
                throw new Error('Access your learner gallery before requesting gallery data.');
            }
            return invoke('parent-gallery', { accessToken: accessToken });
        },
        submitOrder: async function (selection) {
            const accessToken = global.sessionStorage.getItem(parentAccessKey);
            if (!accessToken) {
                throw new Error('Access your learner gallery before submitting an order request.');
            }
            return invoke('parent-submit-order', {
                accessToken: accessToken,
                photoIds: selection.photoIds,
                packageIds: selection.packageIds,
                parentNote: selection.parentNote || ''
            });
        },
        orders: async function () {
            const accessToken = global.sessionStorage.getItem(parentAccessKey);
            if (!accessToken) {
                throw new Error('Access your learner gallery to view order requests.');
            }
            return invoke('parent-orders', { accessToken: accessToken });
        },
        endSession: async function () {
            const accessToken = global.sessionStorage.getItem(parentAccessKey);
            if (!accessToken) {
                return;
            }
            try {
                await invoke('parent-end-session', { accessToken: accessToken });
            } finally {
                global.sessionStorage.removeItem(parentAccessKey);
            }
        },
        clearAccess: function () {
            global.sessionStorage.removeItem(parentAccessKey);
        }
    });

    async function getActivePackages() {
        const result = await getClient()
            .from('packages')
            .select('id, name, description, price_cents, display_order')
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('name', { ascending: true });
        if (result.error) {
            raise(result.error, 'Unable to load current photography packages.');
        }
        return result.data;
    }

    async function submitBooking(booking) {
        return invoke('create-booking', booking);
    }

    global.MCMBackend = Object.freeze({
        isConfigured: isConfigured,
        isReady: isReady,
        readinessMessage: readinessMessage,
        configurationError: configurationError,
        getClient: getClient,
        invoke: invoke,
        getActivePackages: getActivePackages,
        submitBooking: submitBooking,
        admin: admin,
        parent: parent
    });
}(window));
