(function () {
    'use strict';

    const content = document.getElementById('admin-content');
    const status = document.getElementById('admin-status');
    const workspaceStatus = document.getElementById('admin-workspace-status');
    const loginShell = document.getElementById('admin-login');
    const workspace = document.getElementById('admin-app');
    const sectionRoot = document.getElementById('admin-sections');
    const pageTitle = document.getElementById('admin-page-title');
    let activeSection = 'overview';
    const records = {
        schools: [],
        projects: [],
        classes: [],
        learners: [],
        photos: [],
        packages: [],
        content: [],
        bookings: [],
        orders: [],
        orderItems: [],
        audit: []
    };

    function setStatus(message, isError) {
        [status, workspaceStatus].forEach(function (target) {
            if (!target) return;
            target.textContent = message || '';
            target.classList.toggle('is-error', Boolean(isError));
        });
    }

    function isSafeWebsiteUrl(value) {
        try {
            const parsed = new URL(value, window.location.origin);
            return parsed.protocol === 'https:' ||
                (parsed.protocol === 'http:' && parsed.origin === window.location.origin);
        } catch (error) {
            return false;
        }
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function setConfigurationRequired() {
        content.replaceChildren();
        const message = element(
            'p',
            '',
            window.MCMBackend
                ? window.MCMBackend.readinessMessage() + ' Admin access remains locked.'
                : 'The backend client is unavailable. Admin access remains locked.'
        );
        const instruction = element(
            'p',
            '',
            window.MCMBackend && !window.MCMBackend.configurationError()
                ? 'Deploy the schema and Edge Functions, invite the first admin, then set backendReady to true in js/backend-config.js.'
                : 'Add the Supabase project URL and publishable key to js/backend-config.js.'
        );
        content.append(message, instruction);
    }

    function makeField(labelText, name, type, options) {
        const wrapper = element('div', 'backend-field');
        const label = element('label', '', labelText);
        label.htmlFor = 'admin-' + name;
        let control;
        if (type === 'select') {
            control = document.createElement('select');
            control.multiple = Boolean(options.multiple);
            const prompt = element('option', '', options.prompt || 'Choose…');
            prompt.value = '';
            if (!control.multiple) control.appendChild(prompt);
            (options.items || []).forEach(function (item) {
                const option = element('option', '', options.label(item));
                option.value = item.id;
                control.appendChild(option);
            });
        } else if (type === 'textarea') {
            control = document.createElement('textarea');
            control.rows = options.rows || 3;
        } else {
            control = document.createElement('input');
            control.type = type;
        }
        control.id = 'admin-' + name;
        control.name = name;
        control.required = Boolean(options.required);
        if (options.maxLength) control.maxLength = options.maxLength;
        if (options.pattern) control.pattern = options.pattern;
        if (options.placeholder) control.placeholder = options.placeholder;
        if (options.min !== undefined) control.min = String(options.min);
        if (options.max !== undefined) control.max = String(options.max);
        if (options.step !== undefined) control.step = String(options.step);
        if (options.inputMode) control.inputMode = options.inputMode;
        wrapper.append(label, control);
        return wrapper;
    }

    function makeForm(title, fields, onSubmit) {
        const section = element('section', 'backend-module');
        section.appendChild(element('h2', '', title));
        const form = element('form', 'backend-form backend-form--grid');
        fields.forEach(function (field) {
            form.appendChild(field);
        });
        const submit = element('button', 'btn btn-primary', 'Save');
        submit.type = 'submit';
        form.appendChild(submit);
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (!form.reportValidity()) return;
            submit.disabled = true;
            setStatus('', false);
            try {
                await onSubmit(new FormData(form), form);
                form.reset();
                setStatus(title + ' saved.');
                await refreshData();
            } catch (error) {
                setStatus(error.message || 'The change could not be saved.', true);
            } finally {
                submit.disabled = false;
            }
        });
        section.appendChild(form);
        return section;
    }

    function makeTable(title, headers, rows, rowValues, toggle) {
        const section = element('section', 'backend-module');
        section.appendChild(element('h2', '', title));
        if (!rows.length) {
            section.appendChild(element('p', 'text-muted', 'No records yet.'));
            return section;
        }

        const responsive = element('div', 'table-responsive');
        const table = element('table', 'table admin-table backend-table');
        const head = document.createElement('thead');
        const headingRow = document.createElement('tr');
        headers.forEach(function (header) {
            headingRow.appendChild(element('th', '', header));
        });
        if (toggle) headingRow.appendChild(element('th', '', 'Status'));
        head.appendChild(headingRow);
        const body = document.createElement('tbody');
        rows.forEach(function (record) {
            const row = document.createElement('tr');
            rowValues(record).forEach(function (value) {
                row.appendChild(element('td', '', value == null ? '' : String(value)));
            });
            if (toggle) {
                const cell = document.createElement('td');
                const button = element('button', 'btn btn-sm btn-outline-primary', toggle.label(record));
                button.type = 'button';
                button.addEventListener('click', async function () {
                    button.disabled = true;
                    try {
                        await window.MCMBackend.admin.update(toggle.collection, record.id, toggle.changes(record));
                        setStatus(toggle.success);
                        await refreshData();
                    } catch (error) {
                        button.disabled = false;
                        setStatus(error.message || 'Unable to update record.', true);
                    }
                });
                cell.appendChild(button);
                row.appendChild(cell);
            }
            body.appendChild(row);
        });
        table.append(head, body);
        responsive.appendChild(table);
        section.appendChild(responsive);
        return section;
    }

    function updateDataSelectors() {
        const selectors = [
            { name: 'projectSchool', items: records.schools, label: function (item) { return item.name; } },
            { name: 'classProject', items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } },
            { name: 'learnerClass', items: records.classes, label: function (item) { return item.name; } },
            { name: 'consentLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'pinLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'photoLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'orderLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'orderPhotos', items: records.photos, label: function (item) { return item.title; } },
            { name: 'orderPackages', items: records.packages.filter(function (item) { return item.is_active; }), label: function (item) { return item.name; } },
            { name: 'bookingRecord', items: records.bookings, label: function (item) { return item.booking_code + ' — ' + item.client_name; } },
            { name: 'contentEditRecord', items: records.content, label: function (item) { return item.page_key + ' / ' + item.content_key; } },
            { name: 'orderRecord', items: records.orders, label: function (item) { return item.order_code + ' — ' + item.status; } }
        ];
        selectors.forEach(function (selector) {
            const control = document.querySelector('#admin-' + selector.name);
            if (!control) return;
            const previous = control.multiple
                ? Array.prototype.map.call(control.selectedOptions, function (option) { return option.value; })
                : [control.value];
            control.replaceChildren();
            if (!control.multiple) {
                control.appendChild(element('option', '', 'Choose…'));
                control.options[0].value = '';
            }
            selector.items.forEach(function (item) {
                const option = element('option', '', selector.label(item));
                option.value = item.id;
                option.selected = previous.includes(item.id);
                control.appendChild(option);
            });
            if (!control.multiple && selector.items.some(function (item) { return item.id === previous[0]; })) {
                control.value = previous[0];
            }
            control.disabled = selector.items.length === 0;
        });
        const orderLearner = document.getElementById('admin-orderLearner');
        const orderPhotos = document.getElementById('admin-orderPhotos');
        if (orderLearner && orderPhotos) {
            const selectedPhotoIds = Array.prototype.map.call(orderPhotos.selectedOptions, function (option) {
                return option.value;
            });
            const learnerPhotos = records.photos.filter(function (photo) {
                return photo.learner_id === orderLearner.value;
            });
            orderPhotos.replaceChildren();
            learnerPhotos.forEach(function (photo) {
                const option = element('option', '', photo.title);
                option.value = photo.id;
                option.selected = selectedPhotoIds.includes(photo.id);
                orderPhotos.appendChild(option);
            });
            orderPhotos.disabled = learnerPhotos.length === 0;
        }
        [
            ['contentEditRecord', 'contentEditForm'],
            ['bookingRecord', 'bookingStatusForm'],
            ['orderLearner', 'orderCreateForm'],
            ['orderRecord', 'orderStatusForm'],
            ['productionOrder', 'productionStatusForm']
        ].forEach(function (item) {
            const field = document.getElementById('admin-' + item[0]);
            const form = document.getElementById(item[1]);
            const submit = form && form.querySelector('button[type="submit"]');
            if (field && submit) submit.disabled = field.disabled;
        });
    }

    function makeSection(id, title, description) {
        const section = element('section', 'admin-section');
        section.dataset.adminSection = id;
        section.hidden = true;
        const heading = element('div', 'section-heading');
        const copy = document.createElement('div');
        copy.append(element('h2', '', title), element('p', '', description));
        heading.appendChild(copy);
        section.appendChild(heading);
        return section;
    }

    function makePanel(title) {
        const panel = element('section', 'admin-panel');
        const heading = element('div', 'panel-header');
        heading.appendChild(element('h3', '', title));
        panel.appendChild(heading);
        return panel;
    }

    function activateSection(id) {
        const sections = sectionRoot.querySelectorAll('[data-admin-section]');
        if (!Array.prototype.some.call(sections, function (section) {
            return section.dataset.adminSection === id;
        })) {
            return;
        }

        activeSection = id;
        sections.forEach(function (section) {
            section.hidden = section.dataset.adminSection !== id;
        });
        document.querySelectorAll('[data-section-target]').forEach(function (button) {
            const active = button.dataset.sectionTarget === id;
            button.classList.toggle('active', active);
            if (active) {
                button.setAttribute('aria-current', 'page');
            } else {
                button.removeAttribute('aria-current');
            }
        });
        const activeButton = document.querySelector('[data-section-target="' + id + '"]');
        pageTitle.textContent = activeButton ? activeButton.querySelector('span').textContent : 'Overview';
        const search = document.getElementById('admin-search');
        if (search) search.value = '';
        const activeSectionNode = sectionRoot.querySelector('[data-admin-section="' + id + '"]');
        if (activeSectionNode) {
            activeSectionNode.querySelectorAll('.admin-table tbody tr').forEach(function (row) {
                row.hidden = false;
            });
        }
        document.body.classList.remove('menu-open');
        const toggle = document.getElementById('menu-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function renderOverview() {
        const section = sectionRoot.querySelector('[data-admin-section="overview"]');
        if (!section) return;
        section.replaceChildren();
        const heading = element('div', 'section-heading');
        const headingCopy = document.createElement('div');
        headingCopy.append(
            element('h2', '', 'Overview'),
            element('p', '', 'Live website, booking, school, order and fulfilment activity.')
        );
        heading.appendChild(headingCopy);
        section.appendChild(heading);

        const metrics = element('div', 'stat-grid stat-grid--overview');
        [
            { label: 'Schools', value: records.schools.length, detail: 'in this workspace', tone: 'bronze', icon: 'fa-school', target: 'schools' },
            { label: 'Active projects', value: records.projects.filter(function (item) { return item.status === 'active'; }).length, detail: 'school photography projects', tone: 'amber', icon: 'fa-folder-open', target: 'schools' },
            { label: 'Learners', value: records.learners.length, detail: 'registered learner records', tone: 'green', icon: 'fa-users', target: 'schools' },
            { label: 'New bookings', value: records.bookings.filter(function (item) { return item.status === 'new'; }).length, detail: 'awaiting first contact', tone: 'slate', icon: 'fa-calendar-check', target: 'bookings' },
            { label: 'Open orders', value: records.orders.filter(function (item) { return item.status === 'submitted' || item.status === 'confirmed'; }).length, detail: 'unpaid requests in progress', tone: 'green', icon: 'fa-box', target: 'orders' }
        ].forEach(function (metric) {
            const card = element('button', 'stat-card ' + metric.tone);
            card.type = 'button';
            card.dataset.action = '';
            const icon = element('i', 'fa ' + metric.icon);
            icon.setAttribute('aria-hidden', 'true');
            const iconBox = element('span', 'stat-icon');
            iconBox.appendChild(icon);
            card.append(
                iconBox,
                element('span', 'stat-label', metric.label),
                element('strong', '', String(metric.value)),
                element('span', 'stat-foot', metric.detail)
            );
            card.addEventListener('click', function () {
                activateSection(metric.target);
            });
            metrics.appendChild(card);
        });
        section.appendChild(metrics);

        const grid = element('div', 'content-grid');
        const attention = makePanel('Needs attention');
        attention.id = 'attention-panel';
        const attentionList = element('ul', 'attention-list');
        const pendingConsent = records.learners.filter(function (learner) {
            return learner.consent_status === 'pending';
        }).length;
        const unpublished = records.photos.filter(function (photo) {
            return !photo.is_published;
        }).length;
        const newBookings = records.bookings.filter(function (booking) {
            return booking.status === 'new';
        }).length;
        const submittedOrders = records.orders.filter(function (order) {
            return order.status === 'submitted';
        }).length;
        [
            { count: pendingConsent, text: 'Learners awaiting consent review', target: 'schools' },
            { count: unpublished, text: 'Photos not yet published', target: 'photos' },
            { count: newBookings, text: 'Booking requests awaiting contact', target: 'bookings' },
            { count: submittedOrders, text: 'Parent order requests to review', target: 'orders' }
        ].forEach(function (item) {
            const row = document.createElement('li');
            row.appendChild(element('span', 'attention-count', String(item.count)));
            row.appendChild(element('span', '', item.text));
            const link = element('button', 'text-action', 'Review');
            link.type = 'button';
            link.addEventListener('click', function () {
                activateSection(item.target);
            });
            row.appendChild(link);
            attentionList.appendChild(row);
        });
        if (pendingConsent + unpublished + newBookings + submittedOrders === 0) {
            attention.appendChild(element('p', 'empty-state', 'No bookings, orders, consent or photo publishing tasks are pending.'));
        } else {
            attention.appendChild(attentionList);
        }

        const recent = makePanel('Recent admin activity');
        const activity = element('ul', 'activity-list');
        const auditEntries = records.audit.slice().sort(function (left, right) {
            return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        }).slice(0, 4);
        auditEntries.forEach(function (item) {
            const row = document.createElement('li');
            const time = document.createElement('time');
            const date = new Date(item.created_at);
            time.textContent = Number.isNaN(date.getTime())
                ? ''
                : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
            row.append(
                time,
                element('span', '', item.action + ' ' + String(item.resource_table || 'record').replace(/_/g, ' '))
            );
            activity.appendChild(row);
        });
        if (auditEntries.length) {
            recent.appendChild(activity);
        } else {
            recent.appendChild(element('p', 'empty-state', 'Admin changes will appear here when records are updated.'));
        }
        grid.append(attention, recent);
        section.appendChild(grid);
    }

    function bindWorkspaceControls() {
        if (workspace.dataset.bound === 'true') return;
        workspace.dataset.bound = 'true';
        document.querySelectorAll('[data-section-target]').forEach(function (button) {
            button.addEventListener('click', function () {
                activateSection(button.dataset.sectionTarget);
            });
        });
        const menuToggle = document.getElementById('menu-toggle');
        const closeButton = document.getElementById('sidebar-close');
        const scrim = document.getElementById('admin-scrim');
        function closeSidebar() {
            document.body.classList.remove('menu-open');
            menuToggle.setAttribute('aria-expanded', 'false');
        }
        menuToggle.addEventListener('click', function () {
            if (window.innerWidth <= 900) {
                const open = document.body.classList.toggle('menu-open');
                menuToggle.setAttribute('aria-expanded', String(open));
            } else {
                document.body.classList.toggle('sidebar-collapsed');
            }
        });
        closeButton.addEventListener('click', closeSidebar);
        scrim.addEventListener('click', closeSidebar);
        document.getElementById('admin-notifications').addEventListener('click', function () {
            activateSection('overview');
            const panel = document.getElementById('attention-panel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        document.getElementById('admin-search').addEventListener('input', function (event) {
            const query = event.target.value.trim().toLowerCase();
            const section = sectionRoot.querySelector('[data-admin-section="' + activeSection + '"]');
            if (!section) return;
            section.querySelectorAll('.admin-table tbody tr').forEach(function (row) {
                row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
            });
        });
        const refresh = document.getElementById('admin-refresh');
        if (refresh) {
            refresh.addEventListener('click', function () {
                refreshData().catch(function (error) {
                    setStatus(error.message || 'Unable to load admin data.', true);
                });
            });
        }
        document.getElementById('admin-sign-out').addEventListener('click', async function (event) {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await window.MCMBackend.admin.signOut();
                workspace.hidden = true;
                loginShell.hidden = false;
                setLogin();
                setStatus('Signed out.');
            } catch (error) {
                setStatus(error.message || 'Sign-out failed.', true);
            } finally {
                button.disabled = false;
            }
        });
    }

    function renderWorkspace(user) {
        loginShell.hidden = true;
        workspace.hidden = false;
        document.getElementById('admin-user-email').textContent = user.email || 'Administrator';
        bindWorkspaceControls();
        sectionRoot.replaceChildren(
            makeSection('overview', 'Overview', ''),
            makeSection('website', 'Website Management', 'Edit public text, image and link slots marked with data-cms-key, and manage school packages.'),
            makeSection('bookings', 'Bookings', 'Review and update public booking requests.'),
            makeSection(
                'schools',
                'Schools & Learners',
                'Manage schools, projects, classes, learners, photo consent, and parent access.'
            ),
            makeSection(
                'photos',
                'Photo Management',
                'Upload private learner photos and control which images appear in parent galleries.'
            ),
            makeSection('orders', 'Orders & Payments', 'Manage unpaid parent requests and admin-created orders. No online payment processing is enabled.'),
            makeSection('production', 'Production & Deliveries', 'Update print production and delivery status for each order.'),
            makeSection('settings', 'Settings', 'Review your administrator account and workspace status.')
        );
        const websiteSection = sectionRoot.querySelector('[data-admin-section="website"]');
        const bookingsSection = sectionRoot.querySelector('[data-admin-section="bookings"]');
        const ordersSection = sectionRoot.querySelector('[data-admin-section="orders"]');
        const productionSection = sectionRoot.querySelector('[data-admin-section="production"]');
        const schoolsSection = sectionRoot.querySelector('[data-admin-section="schools"]');
        websiteSection.appendChild(element(
            'p',
            'text-muted',
            'Current page keys: home hero.* and about.*; about story.* and team.image-primary; contact booking.*; services services.*; service-weddings, service-portraits, service-metric and service-fashion hero.*; portfolio gallery.*; school-photography hero.* and packages.*. Use Image for image keys and Link for home hero.cta-book.'
        ));
        const forms = element('div', 'backend-form-grid');
        const schoolForm = makeForm('Add school', [
            makeField('School name', 'schoolName', 'text', { required: true, maxLength: 160 }),
            makeField('URL slug (leave blank to generate)', 'schoolSlug', 'text', { maxLength: 80, pattern: '[a-z0-9]+(-[a-z0-9]+)*' })
        ], async function (data) {
            const name = String(data.get('schoolName')).trim();
            const slug = String(data.get('schoolSlug')).trim() ||
                name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            await window.MCMBackend.admin.create('schools', { name: name, slug: slug });
        });
        const projectForm = makeForm('Add school project', [
            makeField('School', 'projectSchool', 'select', { required: true, items: records.schools, label: function (item) { return item.name; } }),
            makeField('Project name', 'projectName', 'text', { required: true, maxLength: 160 }),
            makeField('School year', 'projectYear', 'number', { required: true, min: 2000, max: 2200, step: 1 })
        ], async function (data) {
            await window.MCMBackend.admin.create('projects', {
                school_id: data.get('projectSchool'),
                name: String(data.get('projectName')).trim(),
                school_year: Number(data.get('projectYear'))
            });
        });
        const classForm = makeForm('Add class', [
            makeField('Project', 'classProject', 'select', { required: true, items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } }),
            makeField('Class name', 'className', 'text', { required: true, maxLength: 100 })
        ], async function (data) {
            await window.MCMBackend.admin.create('classes', {
                project_id: data.get('classProject'),
                name: String(data.get('className')).trim()
            });
        });
        const learnerForm = makeForm('Add learner', [
            makeField('Class', 'learnerClass', 'select', { required: true, items: records.classes, label: function (item) { return item.name; } }),
            makeField('Learner reference code', 'learnerReference', 'text', {
                required: true,
                maxLength: 40,
                pattern: '[A-Za-z0-9-]{4,40}'
            }),
            makeField('Learner display name', 'learnerName', 'text', { required: true, maxLength: 160 })
        ], async function (data) {
            const reference = String(data.get('learnerReference')).trim().toUpperCase();
            await window.MCMBackend.admin.create('learners', {
                class_id: data.get('learnerClass'),
                reference_code: reference,
                display_name: String(data.get('learnerName')).trim()
            });
        });
        const consentForm = makeForm('Record or update photo consent', [
            makeField('Learner', 'consentLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('Consent status', 'consentStatus', 'select', {
                required: true,
                prompt: 'Choose status…',
                items: [
                    { id: 'pending', name: 'Pending' },
                    { id: 'approved', name: 'Approved' },
                    { id: 'denied', name: 'Denied' },
                    { id: 'withdrawn', name: 'Withdrawn' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Consent source / record note', 'consentSource', 'text', {
                maxLength: 500,
                placeholder: 'Required for approved, denied or withdrawn status'
            })
        ], async function (data, form) {
            const consentStatus = String(data.get('consentStatus'));
            const consentSource = String(data.get('consentSource') || '').trim();
            if (consentStatus !== 'pending' && consentSource.length < 3) {
                throw new Error('Add a short consent source or record note before saving this status.');
            }
            await window.MCMBackend.admin.update('learners', data.get('consentLearner'), {
                consent_status: consentStatus,
                consent_recorded_at: consentStatus === 'pending' ? null : new Date().toISOString(),
                consent_source: consentStatus === 'pending' ? null : consentSource
            });
            form.elements.consentSource.value = '';
        });
        const pinForm = makeForm('Set or reset learner PIN', [
            makeField('Learner', 'pinLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('6–12 digit PIN', 'learnerPin', 'password', {
                required: true,
                min: 6,
                maxLength: 12,
                pattern: '[0-9]{6,12}',
                inputMode: 'numeric'
            })
        ], async function (data, form) {
            await window.MCMBackend.admin.setLearnerPin(data.get('pinLearner'), data.get('learnerPin'));
            form.elements.learnerPin.value = '';
        });
        [schoolForm, projectForm, classForm, learnerForm, consentForm, pinForm].forEach(function (form) {
            forms.appendChild(form);
        });
        schoolsSection.appendChild(forms);
        const schoolTablesPanel = makePanel('Current records');
        const schoolTables = element('div', 'backend-tables');
        schoolTables.id = 'school-tables';
        schoolTablesPanel.appendChild(schoolTables);
        schoolsSection.appendChild(schoolTablesPanel);

        const photoSection = sectionRoot.querySelector('[data-admin-section="photos"]');
        const photoForm = makeForm('Upload learner photo', [
            makeField('Learner', 'photoLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('Photo title', 'photoTitle', 'text', { required: true, maxLength: 160 }),
            makeField('Image file (JPEG, PNG or WebP; up to 10 MB)', 'photoFile', 'file', { required: true }),
            makeField('Display order', 'photoOrder', 'number', { required: true, min: 0, max: 10000, step: 1 })
        ], async function (data) {
            const learnerId = String(data.get('photoLearner'));
            const file = data.get('photoFile');
            const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
            if (!(file instanceof File) || !allowedTypes[file.type] || file.size > 10 * 1024 * 1024) {
                throw new Error('Choose a JPEG, PNG or WebP image smaller than 10 MB.');
            }
            const path = learnerId + '/' + crypto.randomUUID() + '.' + allowedTypes[file.type];
            const storage = window.MCMBackend.getClient().storage.from('learner-photos');
            const upload = await storage.upload(path, file, { contentType: file.type, upsert: false });
            if (upload.error) throw upload.error;
            try {
                await window.MCMBackend.admin.create('photos', {
                    learner_id: learnerId,
                    storage_path: path,
                    title: String(data.get('photoTitle')).trim(),
                    display_order: Number(data.get('photoOrder')),
                    is_published: false
                });
            } catch (error) {
                const cleanup = await storage.remove([path]);
                if (cleanup.error) {
                    throw new Error(error.message + ' The uploaded file could not be removed; contact an administrator.');
                }
                throw error;
            }
        });
        photoSection.appendChild(photoForm);
        const photoTablesPanel = makePanel('Photo library');
        const photoTables = element('div', 'backend-tables');
        photoTables.id = 'photo-tables';
        photoTablesPanel.appendChild(photoTables);
        photoSection.appendChild(photoTablesPanel);

        const websiteForms = element('div', 'backend-form-grid');
        const packageForm = makeForm('Add school photography package', [
            makeField('Package name', 'packageName', 'text', { required: true, maxLength: 120 }),
            makeField('Description', 'packageDescription', 'textarea', { maxLength: 3000 }),
            makeField('Price in rand', 'packagePrice', 'number', { required: true, min: 0, max: 999999, step: 0.01 }),
            makeField('Display order', 'packageOrder', 'number', { required: true, min: 0, max: 10000, step: 1 })
        ], async function (data) {
            await window.MCMBackend.admin.create('packages', {
                name: String(data.get('packageName')).trim(),
                description: String(data.get('packageDescription') || '').trim(),
                price_cents: Math.round(Number(data.get('packagePrice')) * 100),
                display_order: Number(data.get('packageOrder')),
                is_active: true
            });
        });
        const contentForm = makeForm('Add public page content', [
            makeField('Page key (for example home or contact)', 'contentPage', 'text', {
                required: true,
                maxLength: 80,
                pattern: '[a-z0-9-]{1,80}'
            }),
            makeField('Content key (must match a page data-cms-key)', 'contentKey', 'text', {
                required: true,
                maxLength: 120,
                pattern: '[a-z0-9._-]{1,120}'
            }),
            makeField('Content type', 'contentType', 'select', {
                required: true,
                items: [
                    { id: 'text', name: 'Text' },
                    { id: 'image', name: 'Image URL or uploaded image' },
                    { id: 'link', name: 'Link URL' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Text or URL', 'contentValue', 'textarea', { rows: 4, maxLength: 10000 }),
            makeField('Optional image file (JPEG, PNG or WebP; up to 10 MB)', 'contentImage', 'file', {}),
            makeField('Publish immediately', 'contentPublished', 'select', {
                required: true,
                items: [
                    { id: 'true', name: 'Yes' },
                    { id: 'false', name: 'No, keep as draft' }
                ],
                label: function (item) { return item.name; }
            })
        ], async function (data) {
            const pageKey = String(data.get('contentPage')).trim();
            const contentType = String(data.get('contentType'));
            const file = data.get('contentImage');
            let value = String(data.get('contentValue') || '').trim();
            let uploadedPath = null;
            if (contentType === 'image' && file instanceof File && file.size > 0) {
                const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
                if (!allowedTypes[file.type] || file.size > 10 * 1024 * 1024) {
                    throw new Error('Choose a JPEG, PNG or WebP image smaller than 10 MB.');
                }
                uploadedPath = 'site/' + pageKey + '/' + crypto.randomUUID() + '.' + allowedTypes[file.type];
                const storage = window.MCMBackend.getClient().storage.from('site-media');
                const upload = await storage.upload(uploadedPath, file, { contentType: file.type, upsert: false });
                if (upload.error) throw upload.error;
                value = storage.getPublicUrl(uploadedPath).data.publicUrl;
            }
            if (!value || ((contentType === 'image' || contentType === 'link') && !isSafeWebsiteUrl(value))) {
                if (uploadedPath) {
                    const cleanup = await window.MCMBackend.getClient().storage.from('site-media').remove([uploadedPath]);
                    if (cleanup.error) {
                        throw new Error('The image URL was invalid and the uploaded image could not be removed; contact an administrator.');
                    }
                }
                throw new Error(contentType === 'text'
                    ? 'Enter the text to publish.'
                    : 'Enter a valid HTTPS URL or upload an image.');
            }
            try {
                await window.MCMBackend.admin.create('content', {
                    page_key: pageKey,
                    content_key: String(data.get('contentKey')).trim(),
                    content_type: contentType,
                    value: value,
                    is_published: String(data.get('contentPublished')) === 'true'
                });
            } catch (error) {
                if (uploadedPath) {
                    const cleanup = await window.MCMBackend.getClient().storage.from('site-media').remove([uploadedPath]);
                    if (cleanup.error) {
                        throw new Error(error.message + ' The uploaded image could not be removed; contact an administrator.');
                    }
                }
                throw error;
            }
        });
        const contentEditForm = makeForm('Edit existing page content', [
            makeField('Content record', 'contentEditRecord', 'select', {
                required: true,
                items: records.content,
                label: function (item) { return item.page_key + ' / ' + item.content_key; }
            }),
            makeField('Page key', 'editContentPage', 'text', { required: true, maxLength: 80, pattern: '[a-z0-9-]{1,80}' }),
            makeField('Content key', 'editContentKey', 'text', { required: true, maxLength: 120, pattern: '[a-z0-9._-]{1,120}' }),
            makeField('Content type', 'editContentType', 'select', {
                required: true,
                items: [
                    { id: 'text', name: 'Text' },
                    { id: 'image', name: 'Image URL' },
                    { id: 'link', name: 'Link URL' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Text or URL', 'editContentValue', 'textarea', { rows: 4, maxLength: 10000 }),
            makeField('Optional replacement image (JPEG, PNG or WebP; up to 10 MB)', 'editContentImage', 'file', {}),
            makeField('Published', 'editContentPublished', 'select', {
                required: true,
                items: [
                    { id: 'true', name: 'Yes' },
                    { id: 'false', name: 'No, draft' }
                ],
                label: function (item) { return item.name; }
            })
        ], async function (data) {
            const contentType = String(data.get('editContentType'));
            const file = data.get('editContentImage');
            let value = String(data.get('editContentValue') || '').trim();
            let uploadedPath = null;
            if (contentType === 'image' && file instanceof File && file.size > 0) {
                const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
                if (!allowedTypes[file.type] || file.size > 10 * 1024 * 1024) {
                    throw new Error('Choose a JPEG, PNG or WebP image smaller than 10 MB.');
                }
                uploadedPath = 'site/' + String(data.get('editContentPage')).trim() + '/' +
                    crypto.randomUUID() + '.' + allowedTypes[file.type];
                const storage = window.MCMBackend.getClient().storage.from('site-media');
                const upload = await storage.upload(uploadedPath, file, { contentType: file.type, upsert: false });
                if (upload.error) throw upload.error;
                value = storage.getPublicUrl(uploadedPath).data.publicUrl;
            }
            if (!value || ((contentType === 'image' || contentType === 'link') && !isSafeWebsiteUrl(value))) {
                if (uploadedPath) {
                    const cleanup = await window.MCMBackend.getClient().storage.from('site-media').remove([uploadedPath]);
                    if (cleanup.error) {
                        throw new Error('The image URL was invalid and the uploaded image could not be removed; contact an administrator.');
                    }
                }
                throw new Error('Enter text or a valid HTTPS URL for this content type.');
            }
            try {
                await window.MCMBackend.admin.update('content', data.get('contentEditRecord'), {
                    page_key: String(data.get('editContentPage')).trim(),
                    content_key: String(data.get('editContentKey')).trim(),
                    content_type: contentType,
                    value: value,
                    is_published: String(data.get('editContentPublished')) === 'true'
                });
            } catch (error) {
                if (uploadedPath) {
                    const cleanup = await window.MCMBackend.getClient().storage.from('site-media').remove([uploadedPath]);
                    if (cleanup.error) {
                        throw new Error(error.message + ' The uploaded image could not be removed; contact an administrator.');
                    }
                }
                throw error;
            }
        });
        contentEditForm.id = 'contentEditForm';
        const editContentElement = contentEditForm.querySelector('form');
        editContentElement.elements.contentEditRecord.addEventListener('change', function () {
            const record = records.content.find(function (item) {
                return item.id === editContentElement.elements.contentEditRecord.value;
            });
            if (!record) return;
            editContentElement.elements.editContentPage.value = record.page_key;
            editContentElement.elements.editContentKey.value = record.content_key;
            editContentElement.elements.editContentType.value = record.content_type;
            editContentElement.elements.editContentValue.value = record.value;
            editContentElement.elements.editContentPublished.value = String(record.is_published);
        });
        [packageForm, contentForm, contentEditForm].forEach(function (form) {
            websiteForms.appendChild(form);
        });
        websiteSection.appendChild(websiteForms);
        const websiteTablesPanel = makePanel('Published website data');
        const websiteTables = element('div', 'backend-tables');
        websiteTables.id = 'website-tables';
        websiteTablesPanel.appendChild(websiteTables);
        websiteSection.appendChild(websiteTablesPanel);

        const bookingStatusForm = makeForm('Update booking request', [
            makeField('Booking', 'bookingRecord', 'select', {
                required: true,
                items: records.bookings,
                label: function (item) { return item.booking_code + ' — ' + item.client_name; }
            }),
            makeField('Status', 'bookingStatus', 'select', {
                required: true,
                items: [
                    { id: 'new', name: 'New' },
                    { id: 'contacted', name: 'Contacted' },
                    { id: 'confirmed', name: 'Confirmed' },
                    { id: 'completed', name: 'Completed' },
                    { id: 'cancelled', name: 'Cancelled' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Internal notes', 'bookingNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            await window.MCMBackend.admin.update('bookings', data.get('bookingRecord'), {
                status: String(data.get('bookingStatus')),
                admin_notes: String(data.get('bookingNotes') || '').trim()
            });
        });
        bookingStatusForm.id = 'bookingStatusForm';
        const bookingEditElement = bookingStatusForm.querySelector('form');
        bookingEditElement.elements.bookingRecord.addEventListener('change', function () {
            const record = records.bookings.find(function (item) {
                return item.id === bookingEditElement.elements.bookingRecord.value;
            });
            if (!record) return;
            bookingEditElement.elements.bookingStatus.value = record.status;
            bookingEditElement.elements.bookingNotes.value = record.admin_notes || '';
        });
        bookingsSection.append(bookingStatusForm);
        const bookingTablesPanel = makePanel('Booking requests');
        const bookingTables = element('div', 'backend-tables');
        bookingTables.id = 'booking-tables';
        bookingTablesPanel.appendChild(bookingTables);
        bookingsSection.appendChild(bookingTablesPanel);

        const orderForm = makeForm('Create admin order', [
            makeField('Learner', 'orderLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('Photos (optional; select multiple)', 'orderPhotos', 'select', { multiple: true, items: records.photos, label: function (item) { return item.title; } }),
            makeField('Packages (optional; select multiple)', 'orderPackages', 'select', { multiple: true, items: records.packages, label: function (item) { return item.name; } }),
            makeField('Admin notes', 'orderAdminNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            const result = await window.MCMBackend.admin.createOrder(
                String(data.get('orderLearner')),
                data.getAll('orderPhotos').filter(Boolean),
                data.getAll('orderPackages').filter(Boolean),
                String(data.get('orderAdminNotes') || '').trim()
            );
            setStatus('Order ' + result.order_code + ' created.');
        });
        orderForm.id = 'orderCreateForm';
        orderForm.querySelector('form').elements.orderLearner.addEventListener('change', updateDataSelectors);
        const orderStatusForm = makeForm('Update order status', [
            makeField('Order', 'orderRecord', 'select', {
                required: true,
                items: records.orders,
                label: function (item) { return item.order_code + ' — ' + item.status; }
            }),
            makeField('Order status', 'orderStatus', 'select', {
                required: true,
                items: [
                    { id: 'submitted', name: 'Submitted' },
                    { id: 'confirmed', name: 'Confirmed' },
                    { id: 'cancelled', name: 'Cancelled' },
                    { id: 'complete', name: 'Complete' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Admin notes', 'orderEditNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            await window.MCMBackend.admin.update('orders', data.get('orderRecord'), {
                status: String(data.get('orderStatus')),
                admin_notes: String(data.get('orderEditNotes') || '').trim()
            });
        });
        orderStatusForm.id = 'orderStatusForm';
        const orderEditElement = orderStatusForm.querySelector('form');
        orderEditElement.elements.orderRecord.addEventListener('change', function () {
            const record = records.orders.find(function (item) {
                return item.id === orderEditElement.elements.orderRecord.value;
            });
            if (!record) return;
            orderEditElement.elements.orderStatus.value = record.status;
            orderEditElement.elements.orderEditNotes.value = record.admin_notes || '';
        });
        [orderForm, orderStatusForm].forEach(function (form) {
            ordersSection.appendChild(form);
        });
        const orderTablesPanel = makePanel('Orders');
        const orderTables = element('div', 'backend-tables');
        orderTables.id = 'order-tables';
        orderTablesPanel.appendChild(orderTables);
        ordersSection.appendChild(orderTablesPanel);

        const productionForm = makeForm('Update production and delivery', [
            makeField('Order', 'productionOrder', 'select', {
                required: true,
                items: records.orders,
                label: function (item) { return item.order_code + ' — ' + item.status; }
            }),
            makeField('Production status', 'productionStatus', 'select', {
                required: true,
                items: [
                    { id: 'pending', name: 'Pending' },
                    { id: 'in_production', name: 'In production' },
                    { id: 'ready', name: 'Ready' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Delivery status', 'deliveryStatus', 'select', {
                required: true,
                items: [
                    { id: 'not_started', name: 'Not started' },
                    { id: 'ready_for_collection', name: 'Ready for collection' },
                    { id: 'dispatched', name: 'Dispatched' },
                    { id: 'delivered', name: 'Delivered' }
                ],
                label: function (item) { return item.name; }
            })
        ], async function (data) {
            await window.MCMBackend.admin.update('orders', data.get('productionOrder'), {
                production_status: String(data.get('productionStatus')),
                delivery_status: String(data.get('deliveryStatus'))
            });
        });
        productionForm.id = 'productionStatusForm';
        const productionEditElement = productionForm.querySelector('form');
        productionEditElement.elements.productionOrder.addEventListener('change', function () {
            const record = records.orders.find(function (item) {
                return item.id === productionEditElement.elements.productionOrder.value;
            });
            if (!record) return;
            productionEditElement.elements.productionStatus.value = record.production_status;
            productionEditElement.elements.deliveryStatus.value = record.delivery_status;
        });
        productionSection.appendChild(productionForm);
        const productionTablesPanel = makePanel('Production queue');
        const productionTables = element('div', 'backend-tables');
        productionTables.id = 'production-tables';
        productionTablesPanel.appendChild(productionTables);
        productionSection.appendChild(productionTablesPanel);

        const settingsSection = sectionRoot.querySelector('[data-admin-section="settings"]');
        const accountPanel = makePanel('Administrator account');
        const detailList = element('dl', 'detail-list');
        [
            ['Signed in as', user.email || 'Administrator'],
            ['Access level', 'Administrator'],
            ['Backend', 'Supabase']
        ].forEach(function (item) {
            const row = document.createElement('div');
            row.append(element('dt', '', item[0]), element('dd', '', item[1]));
            detailList.appendChild(row);
        });
        accountPanel.appendChild(detailList);
        settingsSection.appendChild(accountPanel);
        const auditPanel = makePanel('Recent admin audit log');
        const auditTable = element('div', 'backend-tables');
        auditTable.id = 'audit-tables';
        auditPanel.appendChild(auditTable);
        settingsSection.appendChild(auditPanel);

        updateDataSelectors();
        bindWorkspaceControls();
        activateSection(activeSection);
        setStatus('Loading live admin data…');
        refreshData().catch(function (error) {
            setStatus(error.message || 'Unable to load admin data.', true);
        });
    }

    async function refreshData() {
        const [schools, projects, classes, learners, photos, packages, audit] = await Promise.all([
            window.MCMBackend.admin.list('schools'),
            window.MCMBackend.admin.list('projects'),
            window.MCMBackend.admin.list('classes'),
            window.MCMBackend.admin.list('learners'),
            window.MCMBackend.admin.list('photos'),
            window.MCMBackend.admin.list('packages'),
            window.MCMBackend.admin.list('audit')
        ]);
        const optionalCollections = await Promise.all(['content', 'bookings', 'orders', 'orderItems'].map(async function (name) {
            try {
                return { name: name, data: await window.MCMBackend.admin.list(name), error: null };
            } catch (error) {
                return { name: name, data: [], error: error };
            }
        }));
        records.schools = schools;
        records.projects = projects;
        records.classes = classes;
        records.learners = learners;
        records.photos = photos;
        records.packages = packages;
        optionalCollections.forEach(function (result) {
            records[result.name] = result.data;
        });
        records.audit = audit;
        updateDataSelectors();
        renderWorkspaceTables();
        renderOverview();
        const unavailable = optionalCollections.filter(function (result) { return result.error; });
        if (unavailable.length) {
            setStatus('Some workflow data is unavailable: ' +
                unavailable.map(function (result) {
                    return result.name + ' (' + result.error.message + ')';
                }).join('; ') + '. Check the incremental migration, RLS and connectivity.', true);
        } else {
            setStatus('Admin data loaded.');
        }
    }

    function renderWorkspaceTables() {
        const schoolContainer = document.getElementById('school-tables');
        const photoContainer = document.getElementById('photo-tables');
        const websiteContainer = document.getElementById('website-tables');
        const bookingContainer = document.getElementById('booking-tables');
        const orderContainer = document.getElementById('order-tables');
        const productionContainer = document.getElementById('production-tables');
        const auditContainer = document.getElementById('audit-tables');
        if (schoolContainer) schoolContainer.replaceChildren(
            makeTable('Schools', ['Name', 'Slug'], records.schools, function (item) {
            return [item.name, item.slug];
        }, {
            collection: 'schools',
            label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
            changes: function (item) { return { is_active: !item.is_active }; },
            success: 'School status updated.'
        }),
            makeTable('Projects', ['Project', 'Year', 'Status'], records.projects, function (item) {
            return [item.name, item.school_year, item.status];
        }, {
            collection: 'projects',
            label: function (item) { return item.status === 'active' ? 'Pause' : 'Activate'; },
            changes: function (item) { return { status: item.status === 'active' ? 'draft' : 'active' }; },
            success: 'Project status updated.'
        }),
            makeTable('Classes', ['Class'], records.classes, function (item) {
            return [item.name];
        }),
            makeTable('Learners', ['Name', 'Reference code', 'Photo consent'], records.learners, function (item) {
            return [item.display_name, item.reference_code, item.consent_status];
        }, {
            collection: 'learners',
            label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
            changes: function (item) { return { is_active: !item.is_active }; },
            success: 'Learner status updated.'
        })
        );
        if (photoContainer) photoContainer.replaceChildren(
            makeTable('Photos', ['Title', 'Learner ID', 'Order'], records.photos, function (item) {
                return [item.title, item.learner_id, item.display_order];
            }, {
                collection: 'photos',
                label: function (item) { return item.is_published ? 'Unpublish' : 'Publish'; },
                changes: function (item) { return { is_published: !item.is_published }; },
                success: 'Photo visibility updated.'
            })
        );
        if (websiteContainer) websiteContainer.replaceChildren(
            makeTable('Photography packages', ['Name', 'Price', 'Description'], records.packages, function (item) {
                return [item.name, (Number(item.price_cents) / 100).toFixed(2), item.description];
            }, {
                collection: 'packages',
                label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
                changes: function (item) { return { is_active: !item.is_active }; },
                success: 'Package status updated.'
            }),
            makeTable('Page content', ['Page', 'Content key', 'Type', 'Value'], records.content, function (item) {
                return [item.page_key, item.content_key, item.content_type, item.value];
            }, {
                collection: 'content',
                label: function (item) { return item.is_published ? 'Unpublish' : 'Publish'; },
                changes: function (item) { return { is_published: !item.is_published }; },
                success: 'Website content visibility updated.'
            })
        );
        if (bookingContainer) bookingContainer.replaceChildren(
            makeTable('Booking requests', ['Reference', 'Client', 'Email', 'Service', 'Preferred date', 'Status'], records.bookings, function (item) {
                return [item.booking_code, item.client_name, item.email, item.service_type, item.preferred_date, item.status];
            }, {
                collection: 'bookings',
                label: function (item) {
                    if (item.status === 'new') return 'Mark contacted';
                    if (item.status === 'contacted') return 'Confirm';
                    if (item.status === 'confirmed') return 'Complete';
                    return 'Reopen';
                },
                changes: function (item) {
                    const next = { new: 'contacted', contacted: 'confirmed', confirmed: 'completed', completed: 'new', cancelled: 'new' };
                    return { status: next[item.status] || 'new' };
                },
                success: 'Booking status updated.'
            })
        );
        const orderItemsByOrder = {};
        records.orderItems.forEach(function (item) {
            orderItemsByOrder[item.order_id] = (orderItemsByOrder[item.order_id] || 0) + 1;
        });
        const learnerById = {};
        records.learners.forEach(function (learner) {
            learnerById[learner.id] = learner.display_name;
        });
        const orderRows = records.orders.slice().sort(function (left, right) {
            return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        });
        const orderTable = makeTable('Order requests', ['Reference', 'Learner', 'Source', 'Items', 'Status', 'Production', 'Delivery'], orderRows, function (item) {
            return [
                item.order_code,
                learnerById[item.learner_id] || 'Learner record',
                item.source,
                orderItemsByOrder[item.id] || 0,
                item.status,
                item.production_status,
                item.delivery_status
            ];
        }, {
            collection: 'orders',
            label: function (item) {
                if (item.status === 'submitted') return 'Confirm';
                if (item.status === 'confirmed') return 'Complete';
                return 'Reopen';
            },
            changes: function (item) {
                const next = { submitted: 'confirmed', confirmed: 'complete', cancelled: 'submitted', complete: 'confirmed' };
                return { status: next[item.status] || 'submitted' };
            },
            success: 'Order status updated.'
        });
        if (orderContainer) orderContainer.replaceChildren(orderTable);
        if (productionContainer) productionContainer.replaceChildren(
            makeTable('Production and delivery queue', ['Reference', 'Learner', 'Status', 'Production', 'Delivery', 'Created'], orderRows, function (item) {
                return [
                    item.order_code,
                    learnerById[item.learner_id] || 'Learner record',
                    item.status,
                    item.production_status,
                    item.delivery_status,
                    new Date(item.created_at).toLocaleDateString()
                ];
            })
        );
        if (auditContainer) auditContainer.replaceChildren(
            makeTable('Audit log', ['Action', 'Table', 'Record', 'Date'], records.audit.slice().sort(function (left, right) {
                return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
            }).slice(0, 100), function (item) {
                return [item.action, item.resource_table, item.resource_id, new Date(item.created_at).toLocaleString()];
            })
        );
    }

    function setLogin() {
        content.replaceChildren();
        const form = element('form', 'backend-form');
        const emailField = makeField('Email', 'email', 'email', { required: true });
        const passwordField = makeField('Password', 'password', 'password', { required: true });
        form.append(emailField, passwordField);
        const submit = element('button', 'btn btn-primary mt-3', 'Sign in');
        submit.type = 'submit';
        form.appendChild(submit);
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (!form.reportValidity()) return;
            submit.disabled = true;
            setStatus('', false);
            try {
                const user = await window.MCMBackend.admin.signIn(
                    form.elements.email.value.trim(),
                    form.elements.password.value
                );
                form.elements.password.value = '';
                renderWorkspace(user);
            } catch (error) {
                setStatus(error.message || 'Administrator sign-in failed.', true);
                submit.disabled = false;
            }
        });
        const passwordLink = element('a', 'backend-password-link', 'Have an invitation? Set your password');
        passwordLink.href = 'set-password.html';
        content.append(form, passwordLink);
    }

    async function initialize() {
        if (!window.MCMBackend || !window.MCMBackend.isReady()) {
            setConfigurationRequired();
            return;
        }
        try {
            const user = await window.MCMBackend.admin.sessionUser();
            if (user) {
                renderWorkspace(user);
            } else {
                setLogin();
            }
        } catch (error) {
            setLogin();
            setStatus(error.message || 'Unable to verify the administrator session.', true);
        }
    }

    initialize();
}());
