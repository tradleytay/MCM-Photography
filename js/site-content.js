(function () {
    'use strict';

    function loadScript(source) {
        return new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = source;
            script.onload = resolve;
            script.onerror = function () {
                reject(new Error('Unable to load public website content service.'));
            };
            document.head.appendChild(script);
        });
    }

    function loadDependencies() {
        const scriptUrl = document.currentScript && document.currentScript.src
            ? document.currentScript.src
            : new URL('site-content.js', window.location.href).href;
        const baseUrl = new URL('.', scriptUrl);
        const configUrl = new URL('backend-config.js', baseUrl).href;
        const clientUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

        const configReady = window.MCM_BACKEND_CONFIG
            ? Promise.resolve()
            : loadScript(configUrl);
        return configReady.then(function () {
            return window.supabase && typeof window.supabase.createClient === 'function'
                ? undefined
                : loadScript(clientUrl);
        }).then(function () {
            const config = window.MCM_BACKEND_CONFIG || {};
            if (!config.supabaseUrl || !config.supabasePublishableKey) {
                throw new Error('Public content is not configured.');
            }
            return window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
                auth: { persistSession: false, autoRefreshToken: false }
            });
        });
    }

    function getPageKey() {
        if (document.body.dataset.cmsPage) return document.body.dataset.cmsPage;
        const file = window.location.pathname.split('/').pop() || 'index.html';
        return file.replace(/\.html$/i, '') || 'index';
    }

    function applyContent(records) {
        records.forEach(function (record) {
            document.querySelectorAll('[data-cms-key]').forEach(function (target) {
                if (target.dataset.cmsKey !== record.content_key) return;
                if (record.content_type === 'text') {
                    target.textContent = record.value;
                    return;
                }
                let url;
                try {
                    url = new URL(record.value, window.location.origin);
                } catch (error) {
                    console.error('Skipped invalid published website URL for', record.content_key);
                    return;
                }
                if (url.protocol !== 'https:' &&
                    !(url.protocol === 'http:' && url.origin === window.location.origin)) {
                    console.error('Skipped unsafe published website URL for', record.content_key);
                    return;
                }
                if (record.content_type === 'image' && target instanceof HTMLImageElement) {
                    target.src = url.href;
                } else if (record.content_type === 'link' && target instanceof HTMLAnchorElement) {
                    target.href = url.href;
                }
            });
        });
    }

    function renderPackages(client) {
        const container = document.querySelector('[data-package-list]');
        if (!container) return Promise.resolve();
        return client.from('packages')
            .select('name, description, price_cents, display_order')
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('name', { ascending: true })
            .then(function (result) {
                if (result.error) throw result.error;
                container.replaceChildren();
                if (!result.data.length) {
                    const empty = document.createElement('p');
                    empty.className = 'col-12 text-muted';
                    empty.textContent = 'Photography packages will be announced soon.';
                    container.appendChild(empty);
                    return;
                }
                result.data.forEach(function (item) {
                    const card = document.createElement('article');
                    card.className = 'col-md-6 col-lg-4';
                    const body = document.createElement('div');
                    body.className = 'package-card package-card--compact h-100';
                    const name = document.createElement('h3');
                    name.textContent = item.name;
                    const price = document.createElement('p');
                    price.className = 'package-price';
                    price.textContent = new Intl.NumberFormat('en-ZA', {
                        style: 'currency',
                        currency: 'ZAR'
                    }).format(Number(item.price_cents) / 100);
                    const description = document.createElement('p');
                    description.textContent = item.description || '';
                    body.append(name, price, description);
                    card.appendChild(body);
                    container.appendChild(card);
                });
            });
    }

    function renderBookingServices(client) {
        const select = document.querySelector('#contactForm select[name="serviceType"]');
        if (!select) return Promise.resolve();
        return client.from('booking_services')
            .select('name')
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('name', { ascending: true })
            .then(function (result) {
                if (result.error) throw result.error;
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.disabled = true;
                placeholder.selected = true;
                placeholder.textContent = 'Choose a service';
                select.replaceChildren(placeholder);
                result.data.forEach(function (service) {
                    const option = document.createElement('option');
                    option.value = service.name;
                    option.textContent = service.name;
                    select.appendChild(option);
                });
            });
    }

    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1') {
        return;
    }

    loadDependencies().then(function (client) {
        return Promise.all([
            client.from('site_content')
                .select('content_key, content_type, value')
                .eq('page_key', getPageKey())
                .eq('is_published', true)
                .then(function (result) {
                    if (result.error) throw result.error;
                    applyContent(result.data);
                }),
            renderPackages(client),
            renderBookingServices(client)
        ]);
    }).catch(function (error) {
        console.error('Unable to load published website content.', error);
    });
}());
