(function () {
    'use strict';

    const content = document.getElementById('admin-content');
    const status = document.getElementById('admin-status');
    const records = {
        schools: [],
        projects: [],
        classes: [],
        learners: [],
        photos: []
    };

    function setStatus(message, isError) {
        status.textContent = message || '';
        status.classList.toggle('is-error', Boolean(isError));
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
            const prompt = element('option', '', options.prompt || 'Choose…');
            prompt.value = '';
            control.appendChild(prompt);
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
        const table = element('table', 'table backend-table');
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
            { name: 'photoLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }
        ];
        selectors.forEach(function (selector) {
            const control = document.querySelector('#admin-' + selector.name);
            if (!control) return;
            const previous = control.value;
            control.replaceChildren(element('option', '', 'Choose…'));
            control.options[0].value = '';
            selector.items.forEach(function (item) {
                const option = element('option', '', selector.label(item));
                option.value = item.id;
                control.appendChild(option);
            });
            if (selector.items.some(function (item) { return item.id === previous; })) {
                control.value = previous;
            }
            control.disabled = selector.items.length === 0;
        });
    }

    function renderWorkspace(user) {
        content.replaceChildren();
        content.closest('.backend-card').classList.add('backend-card--wide');

        const header = element('div', 'backend-workspace-header');
        const welcome = element('p', '', 'Signed in as ' + user.email);
        const actions = element('div', 'backend-workspace-actions');
        const refresh = element('button', 'btn btn-outline-primary', 'Refresh data');
        refresh.type = 'button';
        refresh.addEventListener('click', function () {
            refreshData().catch(function (error) {
                setStatus(error.message || 'Unable to load admin data.', true);
            });
        });
        const signOut = element('button', 'btn btn-outline-secondary', 'Sign out');
        signOut.type = 'button';
        signOut.addEventListener('click', async function () {
            signOut.disabled = true;
            try {
                await window.MCMBackend.admin.signOut();
                content.closest('.backend-card').classList.remove('backend-card--wide');
                setLogin();
                setStatus('Signed out.');
            } catch (error) {
                signOut.disabled = false;
                setStatus(error.message || 'Sign-out failed.', true);
            }
        });
        actions.append(refresh, signOut);
        header.append(welcome, actions);
        content.appendChild(header);
        content.appendChild(element(
            'p',
            'text-muted',
            'Create school records, learner access codes, and private gallery photos. Parent access requires recorded consent. Online orders and payments are disabled.'
        ));

        const schoolForm = makeForm('Add school', [
            makeField('School name', 'schoolName', 'text', { required: true, maxLength: 160 }),
            makeField('URL slug (leave blank to generate)', 'schoolSlug', 'text', { maxLength: 80, pattern: '[a-z0-9]+(-[a-z0-9]+)*' })
        ], async function (data, form) {
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
            await window.MCMBackend.admin.setLearnerPin(
                data.get('pinLearner'),
                data.get('learnerPin')
            );
            form.elements.learnerPin.value = '';
        });

        const photoForm = makeForm('Upload learner photo', [
            makeField('Learner', 'photoLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('Photo title', 'photoTitle', 'text', { required: true, maxLength: 160 }),
            makeField('Image file (JPEG, PNG or WebP; up to 10 MB)', 'photoFile', 'file', { required: true }),
            makeField('Display order', 'photoOrder', 'number', { required: true, min: 0, max: 10000, step: 1 })
        ], async function (data) {
            const learnerId = String(data.get('photoLearner'));
            const file = data.get('photoFile');
            const allowedTypes = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp'
            };
            if (!(file instanceof File) || !allowedTypes[file.type] || file.size > 10 * 1024 * 1024) {
                throw new Error('Choose a JPEG, PNG or WebP image smaller than 10 MB.');
            }
            const path = learnerId + '/' + crypto.randomUUID() + '.' + allowedTypes[file.type];
            const client = window.MCMBackend.getClient();
            const storage = client.storage.from('learner-photos');
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

        const forms = element('div', 'backend-form-grid');
        [schoolForm, projectForm, classForm, learnerForm, consentForm, pinForm, photoForm].forEach(function (form) {
            forms.appendChild(form);
        });
        content.appendChild(forms);

        const schoolTable = makeTable('Schools', ['Name', 'Slug'], records.schools, function (item) {
            return [item.name, item.slug];
        }, {
            collection: 'schools',
            label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
            changes: function (item) { return { is_active: !item.is_active }; },
            success: 'School status updated.'
        });
        const projectTable = makeTable('Projects', ['Project', 'Year', 'Status'], records.projects, function (item) {
            return [item.name, item.school_year, item.status];
        }, {
            collection: 'projects',
            label: function (item) { return item.status === 'active' ? 'Pause' : 'Activate'; },
            changes: function (item) { return { status: item.status === 'active' ? 'draft' : 'active' }; },
            success: 'Project status updated.'
        });
        const classTable = makeTable('Classes', ['Class'], records.classes, function (item) {
            return [item.name];
        });
        const learnerTable = makeTable('Learners', ['Name', 'Reference code', 'Photo consent'], records.learners, function (item) {
            return [item.display_name, item.reference_code, item.consent_status];
        }, {
            collection: 'learners',
            label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
            changes: function (item) { return { is_active: !item.is_active }; },
            success: 'Learner status updated.'
        });
        const photoTable = makeTable('Photos', ['Title', 'Learner ID', 'Order'], records.photos, function (item) {
            return [item.title, item.learner_id, item.display_order];
        }, {
            collection: 'photos',
            label: function (item) { return item.is_published ? 'Unpublish' : 'Publish'; },
            changes: function (item) { return { is_published: !item.is_published }; },
            success: 'Photo visibility updated.'
        });
        const tableContainer = element('div', 'backend-tables');
        [schoolTable, projectTable, classTable, learnerTable, photoTable].forEach(function (table) {
            tableContainer.appendChild(table);
        });
        content.appendChild(tableContainer);
        updateDataSelectors();
        refreshData().catch(function (error) {
            setStatus(error.message || 'Unable to load admin data.', true);
        });
    }

    async function refreshData() {
        const [schools, projects, classes, learners, photos] = await Promise.all([
            window.MCMBackend.admin.list('schools'),
            window.MCMBackend.admin.list('projects'),
            window.MCMBackend.admin.list('classes'),
            window.MCMBackend.admin.list('learners'),
            window.MCMBackend.admin.list('photos')
        ]);
        records.schools = schools;
        records.projects = projects;
        records.classes = classes;
        records.learners = learners;
        records.photos = photos;
        updateDataSelectors();
        renderWorkspaceTables();
        setStatus('Admin data loaded.');
    }

    function renderWorkspaceTables() {
        const container = content.querySelector('.backend-tables');
        if (!container) return;
        container.replaceChildren(
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
            }),
            makeTable('Photos', ['Title', 'Learner ID', 'Order'], records.photos, function (item) {
                return [item.title, item.learner_id, item.display_order];
            }, {
                collection: 'photos',
                label: function (item) { return item.is_published ? 'Unpublish' : 'Publish'; },
                changes: function (item) { return { is_published: !item.is_published }; },
                success: 'Photo visibility updated.'
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
