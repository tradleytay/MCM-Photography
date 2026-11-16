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
    let photoPreviewDialog;
    let photoPreviewImage;
    let learnerQrDialog;
    let learnerQrImage;
    let learnerQrDownload;
    let currentAdminUserId = '';
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
        audit: [],
        bookingServices: [],
        studioSettings: [],
        guardians: [],
        learnerGuardians: [],
        photoBatches: [],
        payments: [],
        bookingHistory: [],
        orderHistory: [],
        paymentHistory: [],
        downloadRequests: [],
        adminUsers: []
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

    function formatCurrency(cents) {
        return new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR'
        }).format((Number(cents) || 0) / 100);
    }

    function orderTotalCents(orderId) {
        return records.orderItems.reduce(function (total, item) {
            return item.order_id === orderId ? total + Number(item.unit_price_cents || 0) : total;
        }, 0);
    }

    function paymentForOrder(orderId) {
        return records.payments.find(function (payment) {
            return payment.order_id === orderId;
        }) || null;
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let value = '';
        let quoted = false;
        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (quoted && character === '"' && text[index + 1] === '"') {
                value += '"';
                index += 1;
            } else if (character === '"') {
                quoted = !quoted;
            } else if (!quoted && character === ',') {
                row.push(value.trim());
                value = '';
            } else if (!quoted && (character === '\n' || character === '\r')) {
                row.push(value.trim());
                if (row.some(function (cell) { return cell !== ''; })) rows.push(row);
                row = [];
                value = '';
                if (character === '\r' && text[index + 1] === '\n') index += 1;
            } else {
                value += character;
            }
        }
        if (quoted) throw new Error('The CSV file contains an unclosed quoted field.');
        row.push(value.trim());
        if (row.some(function (cell) { return cell !== ''; })) rows.push(row);
        return rows;
    }

    function exportCsv(filename, headers, rows) {
        function escapeCell(value) {
            let safeValue = value == null ? '' : String(value);
            if (/^[=+\-@]/.test(safeValue)) safeValue = "'" + safeValue;
            return '"' + safeValue.replace(/"/g, '""') + '"';
        }
        const content = [headers].concat(rows).map(function (row) {
            return row.map(escapeCell).join(',');
        }).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF' + content], {
            type: 'text/csv;charset=utf-8'
        }));
        const link = element('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    async function fileDigest(file) {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
            return byte.toString(16).padStart(2, '0');
        }).join('');
    }

    async function createWatermarkedPreview(file, settings) {
        const bitmap = await createImageBitmap(file);
        const maxWidth = Number(settings.preview_max_width) || 1600;
        const scale = Math.min(1, maxWidth / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            throw new Error('This browser cannot prepare a private gallery preview.');
        }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const watermark = String(settings.watermark_text || 'MCM PHOTOGRAPHY');
        const fontSize = Math.max(18, Math.round(canvas.width * 0.035));
        context.font = '700 ' + fontSize + 'px sans-serif';
        context.textBaseline = 'middle';
        context.fillStyle = 'rgba(255,255,255,' + String(Number(settings.watermark_opacity) || 0.35) + ')';
        context.strokeStyle = 'rgba(0,0,0,0.42)';
        context.lineWidth = Math.max(2, Math.round(fontSize * 0.08));
        context.shadowColor = 'rgba(0,0,0,0.45)';
        context.shadowBlur = Math.round(fontSize * 0.25);
        const position = settings.watermark_position || 'bottom-right';
        const padding = Math.round(fontSize * 0.8);
        let x = padding;
        let y = canvas.height - padding;
        if (position === 'center') {
            x = canvas.width / 2;
            y = canvas.height / 2;
            context.textAlign = 'center';
            context.save();
            context.translate(x, y);
            context.rotate(-Math.PI / 10);
            context.strokeText(watermark, 0, 0, canvas.width * 0.85);
            context.fillText(watermark, 0, 0, canvas.width * 0.85);
            context.restore();
        } else {
            context.textAlign = position === 'bottom-left' ? 'left' : 'right';
            if (position === 'bottom-right') x = canvas.width - padding;
            context.strokeText(watermark, x, y, canvas.width - padding * 2);
            context.fillText(watermark, x, y, canvas.width - padding * 2);
        }
        context.shadowBlur = 0;
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error('The watermarked gallery preview could not be generated.'));
                    return;
                }
                resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '-preview.jpg', {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                }));
            }, 'image/jpeg', Math.min(0.9, Math.max(0.4, Number(settings.preview_quality) / 100 || 0.72)));
        });
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
        if (type === 'file') control.multiple = Boolean(options.multiple);
        if (options.accept) control.accept = options.accept;
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
        if (toggle && !toggle.hideStatus) headingRow.appendChild(element('th', '', 'Status'));
        if (toggle && typeof toggle.actions === 'function') headingRow.appendChild(element('th', '', 'Actions'));
        head.appendChild(headingRow);
        const body = document.createElement('tbody');
        rows.forEach(function (record) {
            const row = document.createElement('tr');
            rowValues(record).forEach(function (value) {
                row.appendChild(element('td', '', value == null ? '' : String(value)));
            });
            if (toggle && !toggle.hideStatus) {
                const cell = document.createElement('td');
                const button = element('button', 'btn btn-sm btn-outline-primary', toggle.label(record));
                button.type = 'button';
                button.disabled = typeof toggle.disabled === 'function' && toggle.disabled(record);
                button.addEventListener('click', async function () {
                    button.disabled = true;
                    try {
                        if (typeof toggle.confirm === 'function' &&
                            !window.confirm(toggle.confirm(record))) {
                            button.disabled = false;
                            return;
                        }
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
            if (toggle && typeof toggle.actions === 'function') {
                const actionsCell = document.createElement('td');
                toggle.actions(record).forEach(function (action) {
                    const actionButton = element('button', 'btn btn-sm btn-outline-secondary me-1 mb-1', action.label);
                    actionButton.type = 'button';
                    actionButton.addEventListener('click', async function () {
                        actionButton.disabled = true;
                        try {
                            await action.run(record);
                            setStatus(action.success || action.label + ' complete.');
                            await refreshData();
                        } catch (error) {
                            actionButton.disabled = false;
                            setStatus(error.message || action.label + ' failed.', true);
                        }
                    });
                    actionsCell.appendChild(actionButton);
                });
                row.appendChild(actionsCell);
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
            { name: 'packageRecord', items: records.packages, label: function (item) { return item.name; } },
            { name: 'classProject', items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } },
            { name: 'learnerClass', items: records.classes, label: function (item) { return item.name; } },
            { name: 'projectEditSchool', items: records.schools, label: function (item) { return item.name; } },
            { name: 'classEditProject', items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } },
            { name: 'classEditRecord', items: records.classes, label: function (item) { return item.name; } },
            { name: 'learnerEditRecord', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'learnerEditClass', items: records.classes, label: function (item) { return item.name; } },
            { name: 'learnerCsvClass', items: records.classes, label: function (item) { return item.name; } },
            { name: 'consentLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'pinLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'photoLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'orderLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'orderPhotos', items: records.photos, label: function (item) { return item.title; } },
            { name: 'orderPackages', items: records.packages.filter(function (item) { return item.is_active; }), label: function (item) { return item.name; } },
            { name: 'bookingRecord', items: records.bookings, label: function (item) { return item.booking_code + ' — ' + item.client_name; } },
            { name: 'bookingService', items: records.bookingServices.filter(function (item) { return item.is_active; }), label: function (item) { return item.name; } },
            { name: 'contentEditRecord', items: records.content, label: function (item) { return item.page_key + ' / ' + item.content_key; } },
            { name: 'orderRecord', items: records.orders, label: function (item) { return item.order_code + ' — ' + item.status; } },
            { name: 'guardianLearner', items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'guardianRecord', items: records.guardians, label: function (item) { return item.full_name + (item.email ? ' — ' + item.email : ''); } },
            { name: 'photoBatchProject', items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } },
            { name: 'photoAssignRecord', items: records.photos.filter(function (item) { return !item.is_archived; }), label: function (item) { return item.title + (item.learner_id ? ' — assigned' : ' — unassigned'); } },
            { name: 'photoAssignLearner', items: records.learners.filter(function (item) { return item.is_active; }), label: function (item) { return item.display_name + ' — ' + item.reference_code; } },
            { name: 'photoPriceRecord', items: records.photos.filter(function (item) { return item.learner_id && !item.is_archived; }), label: function (item) { return item.title; } },
            { name: 'paymentOrder', items: records.orders, label: function (item) { return item.order_code + ' — ' + item.status; } },
            { name: 'serviceRecord', items: records.bookingServices, label: function (item) { return item.name; } },
            { name: 'projectEditRecord', items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } },
            { name: 'schoolEditRecord', items: records.schools, label: function (item) { return item.name; } }
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
            ['productionOrder', 'productionStatusForm'],
            ['guardianLearner', 'guardianLinkForm'],
            ['guardianRecord', 'guardianLinkForm'],
            ['photoBatchProject', 'photoUploadForm'],
            ['photoAssignRecord', 'photoAssignForm'],
            ['photoAssignLearner', 'photoAssignForm'],
            ['photoPriceRecord', 'photoPriceForm'],
            ['paymentOrder', 'paymentForm'],
            ['serviceRecord', 'serviceEditForm'],
            ['projectEditRecord', 'projectEditForm'],
            ['schoolEditRecord', 'schoolEditForm'],
            ['classEditRecord', 'classEditForm'],
            ['classEditProject', 'classEditForm'],
            ['packageRecord', 'packageEditForm'],
            ['learnerEditRecord', 'learnerEditForm'],
            ['learnerEditClass', 'learnerEditForm'],
            ['learnerCsvClass', 'learnerCsvForm'],
            ['revokeAccessLearner', 'revokeAccessForm'],
            ['bookingService', 'bookingStatusForm']
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
        const unpaidOrders = records.orders.filter(function (order) {
            const payment = paymentForOrder(order.id);
            return !payment || payment.status !== 'verified';
        }).length;
        const unassignedPhotos = records.photos.filter(function (photo) {
            return !photo.learner_id && !photo.is_archived;
        }).length;
        const learnersWithoutPhotos = records.learners.filter(function (learner) {
            return learner.is_active && !records.photos.some(function (photo) {
                return photo.learner_id === learner.id && !photo.is_archived;
            });
        }).length;
        [
            { count: pendingConsent, text: 'Learners awaiting consent review', target: 'schools' },
            { count: unpublished, text: 'Photos not yet published', target: 'photos' },
            { count: unassignedPhotos, text: 'Photos awaiting learner assignment', target: 'photos' },
            { count: learnersWithoutPhotos, text: 'Active learners without a photo', target: 'photos' },
            { count: newBookings, text: 'Booking requests awaiting contact', target: 'bookings' },
            { count: submittedOrders, text: 'Parent order requests to review', target: 'orders' },
            { count: unpaidOrders, text: 'Orders awaiting payment verification', target: 'orders' }
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
        if (pendingConsent + unpublished + unassignedPhotos + learnersWithoutPhotos +
            newBookings + submittedOrders + unpaidOrders === 0) {
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

        const activityGrid = element('div', 'content-grid');
        const recentBookings = makePanel('Recent bookings');
        const bookingRows = records.bookings.slice().sort(function (left, right) {
            return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        }).slice(0, 5);
        if (bookingRows.length) {
            recentBookings.appendChild(makeTable(
                'Latest requests',
                ['Reference', 'Client', 'Service', 'Requested date', 'Status'],
                bookingRows,
                function (booking) {
                    return [
                        booking.booking_code,
                        booking.client_name,
                        booking.service_type,
                        booking.preferred_date || 'Not specified',
                        booking.status
                    ];
                }
            ));
        } else {
            recentBookings.appendChild(element('p', 'empty-state', 'No booking requests have been received.'));
        }
        const recentOrders = makePanel('Recent orders');
        const recentOrderRows = records.orders.slice().sort(function (left, right) {
            return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        }).slice(0, 5);
        if (recentOrderRows.length) {
            recentOrders.appendChild(makeTable(
                'Latest requests',
                ['Reference', 'Amount', 'Payment', 'Production'],
                recentOrderRows,
                function (order) {
                    const payment = paymentForOrder(order.id);
                    return [
                        order.order_code,
                        formatCurrency(orderTotalCents(order.id)),
                        payment ? payment.status.replace(/_/g, ' ') : 'Awaiting payment',
                        order.production_status.replace(/_/g, ' ')
                    ];
                }
            ));
        } else {
            recentOrders.appendChild(element('p', 'empty-state', 'No school photography orders have been received.'));
        }
        activityGrid.append(recentBookings, recentOrders);
        section.appendChild(activityGrid);
    }

    function renderBookingCalendar() {
        const container = document.getElementById('booking-calendar');
        if (!container) return;
        let from = document.getElementById('admin-bookingCalendarFrom').value;
        let to = document.getElementById('admin-bookingCalendarTo').value;
        const view = document.getElementById('admin-bookingCalendarView').value;
        const anchor = document.getElementById('admin-bookingCalendarDate').value;
        const status = document.getElementById('admin-bookingCalendarStatus').value || 'all';
        if (view !== 'range' && anchor) {
            const date = new Date(anchor + 'T00:00:00');
            let start = new Date(date);
            let end = new Date(date);
            if (view === 'week') {
                const mondayOffset = (date.getDay() + 6) % 7;
                start.setDate(date.getDate() - mondayOffset);
                end = new Date(start);
                end.setDate(start.getDate() + 6);
            } else if (view === 'month') {
                start = new Date(date.getFullYear(), date.getMonth(), 1);
                end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            }
            const formatDate = function (value) {
                return value.getFullYear() + '-' +
                    String(value.getMonth() + 1).padStart(2, '0') + '-' +
                    String(value.getDate()).padStart(2, '0');
            };
            from = formatDate(start);
            to = formatDate(end);
        }
        const rows = records.bookings.filter(function (booking) {
            const date = booking.scheduled_date || booking.preferred_date;
            if (!date) return false;
            if (from && date < from) return false;
            if (to && date > to) return false;
            if (status === 'confirmed' && booking.status !== 'confirmed') return false;
            if (status === 'pending' && !['new', 'contacted'].includes(booking.status)) return false;
            return true;
        }).sort(function (left, right) {
            const leftDate = (left.scheduled_date || left.preferred_date) + (left.scheduled_time || left.preferred_time || '');
            const rightDate = (right.scheduled_date || right.preferred_date) + (right.scheduled_time || right.preferred_time || '');
            return leftDate.localeCompare(rightDate);
        });
        const calendarTable = makeTable(
            'Scheduled sessions and requests',
            ['Date', 'Time', 'Client', 'Service', 'Location', 'Status'],
            rows,
            function (booking) {
                return [
                    booking.scheduled_date || booking.preferred_date,
                    String(booking.scheduled_time || booking.preferred_time || '').slice(0, 5) || 'Not specified',
                    booking.client_name,
                    booking.service_type,
                    booking.location || 'Not specified',
                    booking.status
                ];
            }
        );
        container.replaceChildren(calendarTable);
    }

    function populateSettingsForm() {
        const form = document.querySelector('#settingsForm form');
        const settings = records.studioSettings[0];
        if (!form || !settings) return;
        form.elements.settingsBusinessName.value = settings.business_name || '';
        form.elements.settingsBusinessEmail.value = settings.business_email || '';
        form.elements.settingsPhone.value = settings.contact_phone || '';
        form.elements.settingsAddress.value = settings.business_address || '';
        form.elements.settingsWorkdayStart.value = String(settings.working_day_start || '09:00').slice(0, 5);
        form.elements.settingsWorkdayEnd.value = String(settings.working_day_end || '17:00').slice(0, 5);
        form.elements.settingsBookingLeadDays.value = settings.booking_lead_days;
        form.elements.settingsWatermarkText.value = settings.watermark_text || 'MCM PHOTOGRAPHY';
        form.elements.settingsWatermarkOpacity.value = settings.watermark_opacity || 0.35;
        form.elements.settingsWatermarkPosition.value = settings.watermark_position || 'bottom-right';
        form.elements.settingsPreviewQuality.value = settings.preview_quality || 72;
        form.elements.settingsPreviewWidth.value = settings.preview_max_width || 1600;
        form.elements.settingsDownloadPolicy.value = settings.download_policy || 'paid';
        const selectedDays = (settings.working_days || []).map(String);
        Array.prototype.forEach.call(form.elements.settingsWorkingDays.options, function (option) {
            option.selected = selectedDays.includes(option.value);
        });
    }

    async function refreshAdminUsers() {
        const container = document.getElementById('admin-user-table');
        if (!container) return;
        const result = await window.MCMBackend.admin.manageAdminUsers('list');
        records.adminUsers = result.users || [];
        const accountStatus = document.getElementById('admin-user-status');
        if (accountStatus) {
            accountStatus.textContent = '';
            accountStatus.classList.remove('is-error');
        }
        container.replaceChildren(makeTable(
            'Administrator accounts',
            ['Email', 'Created', 'Last sign in', 'Status'],
            records.adminUsers,
            function (user) {
                const suspended = user.banned_until && new Date(user.banned_until).getTime() > Date.now();
                return [
                    user.email,
                    new Date(user.created_at).toLocaleDateString(),
                    user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Invitation pending',
                    suspended ? 'Suspended' : 'Active'
                ];
            },
            {
                hideStatus: true,
                actions: function (user) {
                    if (user.id === currentAdminUserId) return [];
                    const suspended = user.banned_until && new Date(user.banned_until).getTime() > Date.now();
                    return [{
                        label: suspended ? 'Reinstate' : 'Suspend',
                        success: suspended ? 'Administrator account reinstated.' : 'Administrator account suspended.',
                        run: async function () {
                            const verb = suspended ? 'reinstate' : 'suspend';
                            if (!window.confirm(
                                (suspended ? 'Reinstate ' : 'Suspend ') + user.email + '?'
                            )) {
                                throw new Error('Administrator account was not changed.');
                            }
                            await window.MCMBackend.admin.manageAdminUsers(verb, { userId: user.id });
                            await refreshAdminUsers();
                        }
                    }];
                }
            }
        ));
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
                try {
                    const activeUser = await window.MCMBackend.admin.sessionUser();
                    if (!activeUser) {
                        workspace.hidden = true;
                        loginShell.hidden = false;
                        setLogin();
                        setStatus(error.message || 'Signed out, but the audit event could not be recorded.', true);
                    } else {
                        setStatus(error.message || 'Sign-out failed.', true);
                    }
                } catch (sessionError) {
                    workspace.hidden = true;
                    loginShell.hidden = false;
                    setLogin();
                    setStatus(sessionError.message || error.message || 'Sign-out completed with an audit issue.', true);
                }
            } finally {
                button.disabled = false;
            }
        });
    }

    function renderWorkspace(user) {
        loginShell.hidden = true;
        workspace.hidden = false;
        currentAdminUserId = user.id;
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
        const revokeAccessForm = makeForm('Revoke active parent gallery sessions', [
            makeField('Learner', 'revokeAccessLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } })
        ], async function (data) {
            const learner = records.learners.find(function (item) { return item.id === String(data.get('revokeAccessLearner')); });
            if (!learner || !window.confirm('Revoke all current gallery sessions for ' + learner.display_name + '? Parents will need the learner PIN again.')) {
                throw new Error('Parent gallery access was not changed.');
            }
            const count = await window.MCMBackend.admin.revokeLearnerAccess(learner.id);
            setStatus(String(count) + ' active parent session(s) revoked.');
        });
        const schoolEditForm = makeForm('Edit school details', [
            makeField('School', 'schoolEditRecord', 'select', { required: true, items: records.schools, label: function (item) { return item.name; } }),
            makeField('Name', 'schoolEditName', 'text', { required: true, maxLength: 160 }),
            makeField('URL slug', 'schoolEditSlug', 'text', { required: true, maxLength: 80, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }),
            makeField('Contact email', 'schoolEditEmail', 'email', { maxLength: 254 }),
            makeField('Phone', 'schoolEditPhone', 'tel', { maxLength: 40 }),
            makeField('Address', 'schoolEditAddress', 'text', { maxLength: 500 }),
            makeField('Active', 'schoolEditActive', 'select', { required: true, items: [{ id: 'true', name: 'Active' }, { id: 'false', name: 'Inactive' }], label: function (item) { return item.name; } })
        ], async function (data) {
            await window.MCMBackend.admin.update('schools', data.get('schoolEditRecord'), {
                name: String(data.get('schoolEditName')).trim(),
                slug: String(data.get('schoolEditSlug')).trim(),
                contact_email: String(data.get('schoolEditEmail') || '').trim(),
                phone: String(data.get('schoolEditPhone') || '').trim(),
                address: String(data.get('schoolEditAddress') || '').trim(),
                is_active: String(data.get('schoolEditActive')) === 'true'
            });
        });
        schoolEditForm.id = 'schoolEditForm';
        const projectEditForm = makeForm('Edit photography project', [
            makeField('Project', 'projectEditRecord', 'select', { required: true, items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } }),
            makeField('School', 'projectEditSchool', 'select', { required: true, items: records.schools, label: function (item) { return item.name; } }),
            makeField('Project name', 'projectEditName', 'text', { required: true, maxLength: 160 }),
            makeField('School year', 'projectEditYear', 'number', { required: true, min: 2000, max: 2200, step: 1 }),
            makeField('Photography start date', 'projectStartDate', 'date', {}),
            makeField('Photography end date', 'projectEndDate', 'date', {}),
            makeField('Status', 'projectEditStatus', 'select', {
                required: true,
                items: ['draft', 'active', 'complete', 'archived'].map(function (value) { return { id: value, name: value }; }),
                label: function (item) { return item.name; }
            }),
            makeField('Project notes', 'projectEditNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            await window.MCMBackend.admin.update('projects', data.get('projectEditRecord'), {
                school_id: data.get('projectEditSchool'),
                name: String(data.get('projectEditName')).trim(),
                school_year: Number(data.get('projectEditYear')),
                photography_start_date: data.get('projectStartDate') || null,
                photography_end_date: data.get('projectEndDate') || null,
                status: String(data.get('projectEditStatus')),
                notes: String(data.get('projectEditNotes') || '').trim()
            });
        });
        projectEditForm.id = 'projectEditForm';
        const classEditForm = makeForm('Edit class', [
            makeField('Class', 'classEditRecord', 'select', { required: true, items: records.classes, label: function (item) { return item.name; } }),
            makeField('Project', 'classEditProject', 'select', { required: true, items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } }),
            makeField('Class name', 'classEditName', 'text', { required: true, maxLength: 100 })
        ], async function (data) {
            await window.MCMBackend.admin.update('classes', data.get('classEditRecord'), {
                project_id: data.get('classEditProject'),
                name: String(data.get('classEditName')).trim()
            });
        });
        classEditForm.id = 'classEditForm';
        const learnerEditForm = makeForm('Edit learner', [
            makeField('Learner', 'learnerEditRecord', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('Class', 'learnerEditClass', 'select', { required: true, items: records.classes, label: function (item) { return item.name; } }),
            makeField('Learner reference code', 'learnerEditReference', 'text', { required: true, maxLength: 40, pattern: '[A-Za-z0-9-]{4,40}' }),
            makeField('Learner display name', 'learnerEditName', 'text', { required: true, maxLength: 160 }),
            makeField('Active', 'learnerEditActive', 'select', { required: true, items: [{ id: 'true', name: 'Active' }, { id: 'false', name: 'Inactive' }], label: function (item) { return item.name; } })
        ], async function (data) {
            await window.MCMBackend.admin.update('learners', data.get('learnerEditRecord'), {
                class_id: data.get('learnerEditClass'),
                reference_code: String(data.get('learnerEditReference')).trim().toUpperCase(),
                display_name: String(data.get('learnerEditName')).trim(),
                is_active: String(data.get('learnerEditActive')) === 'true'
            });
        });
        learnerEditForm.id = 'learnerEditForm';
        const csvForm = makeForm('Import learners from CSV', [
            makeField('Class', 'learnerCsvClass', 'select', { required: true, items: records.classes, label: function (item) { return item.name; } }),
            makeField('CSV file (reference_code,display_name)', 'learnerCsvFile', 'file', { required: true, accept: '.csv,text/csv' })
        ], async function (data) {
            const file = data.get('learnerCsvFile');
            if (!(file instanceof File) || file.size === 0 || file.size > 2 * 1024 * 1024) {
                throw new Error('Choose a non-empty CSV file smaller than 2 MB.');
            }
            const rows = parseCsv(await file.text());
            if (rows.length < 2) throw new Error('The CSV must include a header and at least one learner.');
            const headers = rows[0].map(function (header) { return header.toLowerCase(); });
            const referenceIndex = headers.indexOf('reference_code');
            const nameIndex = headers.indexOf('display_name');
            if (referenceIndex < 0 || nameIndex < 0) {
                throw new Error('The CSV header must include reference_code and display_name columns.');
            }
            const seen = new Set();
            const learnerRows = rows.slice(1).map(function (row, index) {
                const reference = String(row[referenceIndex] || '').trim().toUpperCase();
                const name = String(row[nameIndex] || '').trim();
                if (!/^[A-Z0-9-]{4,40}$/.test(reference) || name.length < 1 || name.length > 160) {
                    throw new Error('CSV row ' + (index + 2) + ' has an invalid learner reference or display name.');
                }
                if (seen.has(reference) || records.learners.some(function (learner) {
                    return learner.reference_code === reference;
                })) {
                    throw new Error('Learner reference ' + reference + ' appears more than once or already exists.');
                }
                seen.add(reference);
                return {
                    class_id: String(data.get('learnerCsvClass')),
                    reference_code: reference,
                    display_name: name
                };
            });
            await window.MCMBackend.admin.createMany('learners', learnerRows);
        });
        csvForm.id = 'learnerCsvForm';
        const guardianForm = makeForm('Add parent or guardian', [
            makeField('Full name', 'guardianName', 'text', { required: true, maxLength: 160 }),
            makeField('Email', 'guardianEmail', 'email', { maxLength: 254 }),
            makeField('Phone', 'guardianPhone', 'tel', { maxLength: 40 })
        ], async function (data) {
            await window.MCMBackend.admin.create('guardians', {
                full_name: String(data.get('guardianName')).trim(),
                email: String(data.get('guardianEmail') || '').trim(),
                phone: String(data.get('guardianPhone') || '').trim()
            });
        });
        const guardianLinkForm = makeForm('Link guardian to learner', [
            makeField('Learner', 'guardianLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } }),
            makeField('Guardian', 'guardianRecord', 'select', { required: true, items: records.guardians, label: function (item) { return item.full_name + (item.email ? ' — ' + item.email : ''); } }),
            makeField('Relationship', 'guardianRelationship', 'text', { maxLength: 80, placeholder: 'Parent, guardian, etc.' }),
            makeField('Primary contact', 'guardianPrimary', 'select', { required: true, items: [{ id: 'true', name: 'Yes' }, { id: 'false', name: 'No' }], label: function (item) { return item.name; } })
        ], async function (data) {
            await window.MCMBackend.admin.create('learnerGuardians', {
                learner_id: data.get('guardianLearner'),
                guardian_id: data.get('guardianRecord'),
                relationship: String(data.get('guardianRelationship') || '').trim(),
                is_primary: String(data.get('guardianPrimary')) === 'true'
            });
        });
        guardianLinkForm.id = 'guardianLinkForm';
        [
            schoolForm,
            projectForm,
            classForm,
            learnerForm,
            consentForm,
            pinForm,
            revokeAccessForm,
            schoolEditForm,
            projectEditForm,
            classEditForm,
            learnerEditForm,
            csvForm,
            guardianForm,
            guardianLinkForm
        ].forEach(function (form) {
            forms.appendChild(form);
        });
        schoolsSection.appendChild(forms);

        const schoolEditElement = schoolEditForm.querySelector('form');
        schoolEditElement.elements.schoolEditRecord.addEventListener('change', function () {
            const item = records.schools.find(function (record) { return record.id === schoolEditElement.elements.schoolEditRecord.value; });
            if (!item) return;
            schoolEditElement.elements.schoolEditName.value = item.name;
            schoolEditElement.elements.schoolEditSlug.value = item.slug;
            schoolEditElement.elements.schoolEditEmail.value = item.contact_email || '';
            schoolEditElement.elements.schoolEditPhone.value = item.phone || '';
            schoolEditElement.elements.schoolEditAddress.value = item.address || '';
            schoolEditElement.elements.schoolEditActive.value = String(item.is_active);
        });
        const projectEditElement = projectEditForm.querySelector('form');
        projectEditElement.elements.projectEditRecord.addEventListener('change', function () {
            const item = records.projects.find(function (record) { return record.id === projectEditElement.elements.projectEditRecord.value; });
            if (!item) return;
            projectEditElement.elements.projectEditSchool.value = item.school_id;
            projectEditElement.elements.projectEditName.value = item.name;
            projectEditElement.elements.projectEditYear.value = item.school_year;
            projectEditElement.elements.projectStartDate.value = item.photography_start_date || '';
            projectEditElement.elements.projectEndDate.value = item.photography_end_date || '';
            projectEditElement.elements.projectEditStatus.value = item.status;
            projectEditElement.elements.projectEditNotes.value = item.notes || '';
        });
        const classEditElement = classEditForm.querySelector('form');
        classEditElement.elements.classEditRecord.addEventListener('change', function () {
            const item = records.classes.find(function (record) { return record.id === classEditElement.elements.classEditRecord.value; });
            if (!item) return;
            classEditElement.elements.classEditProject.value = item.project_id;
            classEditElement.elements.classEditName.value = item.name;
        });
        const learnerEditElement = learnerEditForm.querySelector('form');
        learnerEditElement.elements.learnerEditRecord.addEventListener('change', function () {
            const item = records.learners.find(function (record) { return record.id === learnerEditElement.elements.learnerEditRecord.value; });
            if (!item) return;
            learnerEditElement.elements.learnerEditClass.value = item.class_id;
            learnerEditElement.elements.learnerEditReference.value = item.reference_code;
            learnerEditElement.elements.learnerEditName.value = item.display_name;
            learnerEditElement.elements.learnerEditActive.value = String(item.is_active);
        });
        const schoolTablesPanel = makePanel('Current records');
        const schoolTables = element('div', 'backend-tables');
        schoolTables.id = 'school-tables';
        schoolTablesPanel.appendChild(schoolTables);
        schoolsSection.appendChild(schoolTablesPanel);

        const photoSection = sectionRoot.querySelector('[data-admin-section="photos"]');
        const photoForm = makeForm('Upload private school photos', [
            makeField('School project', 'photoBatchProject', 'select', { required: true, items: records.projects, label: function (item) { return item.name + ' (' + item.school_year + ')'; } }),
            makeField('Upload batch name', 'photoBatchName', 'text', { required: true, maxLength: 160, placeholder: 'For example: Room 3 morning session' }),
            makeField('Photos (JPEG, PNG or WebP; up to 10 MB each)', 'photoFiles', 'file', { required: true, multiple: true, accept: 'image/jpeg,image/png,image/webp' }),
            makeField('Default price per photo (ZAR)', 'photoDefaultPrice', 'number', { required: true, min: 0, max: 999999, step: 0.01 })
        ], async function (data) {
            const projectId = String(data.get('photoBatchProject'));
            const files = Array.prototype.slice.call(data.get('photoFiles') || []);
            const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
            if (!files.length || files.length > 200) {
                throw new Error('Choose between 1 and 200 photo files per upload batch.');
            }
            files.forEach(function (file) {
                if (!(file instanceof File) || !allowedTypes[file.type] || file.size <= 0 || file.size > 10 * 1024 * 1024) {
                    throw new Error('Every photo must be a non-empty JPEG, PNG or WebP file smaller than 10 MB.');
                }
            });
            const hashes = await Promise.all(files.map(fileDigest));
            const duplicates = hashes.filter(function (hash, index) {
                return hashes.indexOf(hash) !== index || records.photos.some(function (photo) {
                    return photo.sha256 === hash;
                });
            });
            if (duplicates.length) {
                throw new Error('This batch contains duplicate photos or files already in the library. Remove duplicates and retry.');
            }
            const settings = records.studioSettings[0] || {};
            const batch = await window.MCMBackend.admin.create('photoBatches', {
                project_id: projectId,
                label: String(data.get('photoBatchName')).trim()
            });
            const storage = window.MCMBackend.getClient().storage.from('learner-photos');
            const uploadedPaths = [];
            try {
                const photoRows = [];
                for (let index = 0; index < files.length; index += 1) {
                    const file = files[index];
                    const extension = allowedTypes[file.type];
                    const basePath = 'projects/' + projectId + '/' + batch.id + '/' + crypto.randomUUID();
                    const originalPath = basePath + '.' + extension;
                    const previewPath = basePath + '-preview.jpg';
                    const previewFile = await createWatermarkedPreview(file, settings);
                    const originalUpload = await storage.upload(originalPath, file, {
                        contentType: file.type,
                        upsert: false
                    });
                    if (originalUpload.error) throw originalUpload.error;
                    uploadedPaths.push(originalPath);
                    const previewUpload = await storage.upload(previewPath, previewFile, {
                        contentType: 'image/jpeg',
                        upsert: false
                    });
                    if (previewUpload.error) throw previewUpload.error;
                    uploadedPaths.push(previewPath);
                    photoRows.push({
                        learner_id: null,
                        project_id: projectId,
                        batch_id: batch.id,
                        storage_path: originalPath,
                        preview_storage_path: previewPath,
                        sha256: hashes[index],
                        title: file.name.replace(/\.[^.]+$/, '').slice(0, 160) || 'School portrait',
                        display_order: index,
                        price_cents: Math.round(Number(data.get('photoDefaultPrice') || 0) * 100),
                        assignment_status: 'unassigned',
                        is_published: false
                    });
                }
                await window.MCMBackend.admin.createMany('photos', photoRows);
            } catch (error) {
                const cleanup = uploadedPaths.length ? await storage.remove(uploadedPaths) : { error: null };
                const batchCleanup = await window.MCMBackend.admin.remove('photoBatches', batch.id);
                if ((cleanup.error || batchCleanup) && error.message) {
                    throw new Error(error.message + ' Some batch files could not be removed; contact an administrator.');
                }
                throw error;
            }
        });
        photoForm.id = 'photoUploadForm';
        photoSection.appendChild(photoForm);
        const photoForms = element('div', 'backend-form-grid');
        const photoAssignForm = makeForm('Assign or reassign a photo', [
            makeField('Photo', 'photoAssignRecord', 'select', { required: true, items: records.photos, label: function (item) { return item.title; } }),
            makeField('Learner', 'photoAssignLearner', 'select', { required: true, items: records.learners, label: function (item) { return item.display_name + ' — ' + item.reference_code; } })
        ], async function (data) {
            const photoId = String(data.get('photoAssignRecord'));
            const photo = records.photos.find(function (item) { return item.id === photoId; });
            if (photo && photo.is_published && !window.confirm('Changing this photo assignment will unpublish it from the previous gallery. Continue?')) {
                throw new Error('Photo assignment was not changed.');
            }
            await window.MCMBackend.admin.update('photos', photoId, {
                learner_id: String(data.get('photoAssignLearner')),
                assignment_status: 'assigned',
                is_published: false
            });
        });
        photoAssignForm.id = 'photoAssignForm';
        const photoPriceForm = makeForm('Set individual photo price', [
            makeField('Assigned photo', 'photoPriceRecord', 'select', { required: true, items: records.photos, label: function (item) { return item.title; } }),
            makeField('Price (ZAR)', 'photoPriceAmount', 'number', { required: true, min: 0, max: 999999, step: 0.01 })
        ], async function (data) {
            await window.MCMBackend.admin.update('photos', data.get('photoPriceRecord'), {
                price_cents: Math.round(Number(data.get('photoPriceAmount')) * 100)
            });
        });
        photoPriceForm.id = 'photoPriceForm';
        const photoPriceElement = photoPriceForm.querySelector('form');
        photoPriceElement.elements.photoPriceRecord.addEventListener('change', function () {
            const photo = records.photos.find(function (item) { return item.id === photoPriceElement.elements.photoPriceRecord.value; });
            if (photo) photoPriceElement.elements.photoPriceAmount.value = (Number(photo.price_cents || 0) / 100).toFixed(2);
        });
        photoForms.append(photoAssignForm, photoPriceForm);
        photoSection.appendChild(photoForms);
        const photoTablesPanel = makePanel('Photo library');
        const photoTables = element('div', 'backend-tables');
        photoTables.id = 'photo-tables';
        photoTablesPanel.appendChild(photoTables);
        photoSection.appendChild(photoTablesPanel);
        photoPreviewDialog = document.createElement('dialog');
        photoPreviewDialog.className = 'photo-preview-dialog';
        photoPreviewDialog.setAttribute('aria-label', 'Private watermarked photo preview');
        const previewClose = element('button', 'btn btn-outline-secondary', 'Close preview');
        previewClose.type = 'button';
        photoPreviewImage = element('img', 'img-fluid', '');
        photoPreviewImage.alt = 'Watermarked learner photo preview';
        photoPreviewDialog.append(previewClose, photoPreviewImage);
        photoSection.appendChild(photoPreviewDialog);
        previewClose.addEventListener('click', function () { photoPreviewDialog.close(); });
        learnerQrDialog = document.createElement('dialog');
        learnerQrDialog.className = 'photo-preview-dialog';
        learnerQrDialog.setAttribute('aria-label', 'Learner parent access QR code');
        const qrClose = element('button', 'btn btn-outline-secondary', 'Close');
        qrClose.type = 'button';
        learnerQrImage = element('img', 'img-fluid learner-qr-image', '');
        learnerQrImage.alt = 'QR code for the parent access page; PIN is not included';
        const qrDescription = element(
            'p',
            'text-muted',
            'This QR code opens the parent access page and fills in the learner reference only. Share the PIN separately.'
        );
        learnerQrDownload = element('a', 'btn btn-primary', 'Download QR');
        learnerQrDialog.append(qrClose, learnerQrImage, qrDescription, learnerQrDownload);
        sectionRoot.appendChild(learnerQrDialog);
        qrClose.addEventListener('click', function () { learnerQrDialog.close(); });

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
        const packageEditForm = makeForm('Edit package and pricing', [
            makeField('Package', 'packageRecord', 'select', { required: true, items: records.packages, label: function (item) { return item.name; } }),
            makeField('Name', 'packageEditName', 'text', { required: true, maxLength: 120 }),
            makeField('Description', 'packageEditDescription', 'textarea', { maxLength: 3000 }),
            makeField('Price (ZAR)', 'packageEditPrice', 'number', { required: true, min: 0, max: 999999, step: 0.01 }),
            makeField('Display order', 'packageEditOrder', 'number', { required: true, min: 0, max: 10000, step: 1 }),
            makeField('Availability', 'packageEditActive', 'select', {
                required: true,
                items: [{ id: 'true', name: 'Active' }, { id: 'false', name: 'Inactive' }],
                label: function (item) { return item.name; }
            })
        ], async function (data) {
            await window.MCMBackend.admin.update('packages', data.get('packageRecord'), {
                name: String(data.get('packageEditName')).trim(),
                description: String(data.get('packageEditDescription') || '').trim(),
                price_cents: Math.round(Number(data.get('packageEditPrice')) * 100),
                display_order: Number(data.get('packageEditOrder')),
                is_active: String(data.get('packageEditActive')) === 'true'
            });
        });
        packageEditForm.id = 'packageEditForm';
        const packageEditElement = packageEditForm.querySelector('form');
        packageEditElement.elements.packageRecord.addEventListener('change', function () {
            const item = records.packages.find(function (record) { return record.id === packageEditElement.elements.packageRecord.value; });
            if (!item) return;
            packageEditElement.elements.packageEditName.value = item.name;
            packageEditElement.elements.packageEditDescription.value = item.description || '';
            packageEditElement.elements.packageEditPrice.value = (Number(item.price_cents) / 100).toFixed(2);
            packageEditElement.elements.packageEditOrder.value = item.display_order;
            packageEditElement.elements.packageEditActive.value = String(item.is_active);
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
        [packageForm, packageEditForm, contentForm, contentEditForm].forEach(function (form) {
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
            makeField('Photography service', 'bookingService', 'select', {
                required: true,
                items: records.bookingServices.filter(function (item) { return item.is_active; }),
                label: function (item) { return item.name; }
            }),
            makeField('Status', 'bookingStatus', 'select', {
                required: true,
                items: [
                    { id: 'new', name: 'New' },
                    { id: 'contacted', name: 'Contacted' },
                    { id: 'confirmed', name: 'Confirmed' },
                    { id: 'completed', name: 'Completed' },
                    { id: 'cancelled', name: 'Cancelled' },
                    { id: 'declined', name: 'Declined' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Confirmed session date', 'bookingScheduledDate', 'date', {}),
            makeField('Confirmed session time', 'bookingScheduledTime', 'time', {}),
            makeField('Session location', 'bookingLocation', 'text', { maxLength: 500 }),
            makeField('Deposit amount (ZAR)', 'bookingDepositAmount', 'number', { min: 0, max: 999999, step: 0.01 }),
            makeField('Deposit transaction reference', 'bookingDepositReference', 'text', { maxLength: 200 }),
            makeField('Deposit received', 'bookingDepositPaid', 'select', {
                required: true,
                items: [{ id: 'false', name: 'Not received' }, { id: 'true', name: 'Received' }],
                label: function (item) { return item.name; }
            }),
            makeField('Internal notes', 'bookingNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            const scheduledDate = String(data.get('bookingScheduledDate') || '');
            const scheduledTime = String(data.get('bookingScheduledTime') || '');
            const status = String(data.get('bookingStatus'));
            if (status === 'confirmed' && (!scheduledDate || !scheduledTime)) {
                throw new Error('Set a confirmed session date and time before confirming this booking.');
            }
            if (status === 'confirmed') {
                const serviceType = String(data.get('bookingService')).trim();
                const service = records.bookingServices.find(function (item) { return item.name === serviceType; });
                const duration = service ? Number(service.duration_minutes) : 60;
                const startMinutes = function (time) {
                    const parts = String(time || '').slice(0, 5).split(':').map(Number);
                    return parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
                };
                const start = startMinutes(scheduledTime);
                const conflicts = records.bookings.some(function (booking) {
                    if (booking.id === String(data.get('bookingRecord')) ||
                        booking.status !== 'confirmed' || booking.scheduled_date !== scheduledDate ||
                        !booking.scheduled_time) return false;
                    const otherService = records.bookingServices.find(function (item) {
                        return item.name === booking.service_type;
                    });
                    const otherStart = startMinutes(booking.scheduled_time);
                    const otherEnd = otherStart + (otherService ? Number(otherService.duration_minutes) : 60);
                    return Math.max(start, otherStart) < Math.min(start + duration, otherEnd);
                });
                if (conflicts) throw new Error('This time overlaps another confirmed session. Choose another available time.');
            }
            const depositPaid = String(data.get('bookingDepositPaid')) === 'true';
            const depositReference = String(data.get('bookingDepositReference') || '').trim();
            if (depositPaid && depositReference.length < 3) {
                throw new Error('Add the bank or cash transaction reference for a received deposit.');
            }
            await window.MCMBackend.admin.update('bookings', data.get('bookingRecord'), {
                status: status,
                service_type: String(data.get('bookingService')).trim(),
                scheduled_date: scheduledDate || null,
                scheduled_time: scheduledTime || null,
                location: String(data.get('bookingLocation') || '').trim(),
                deposit_amount_cents: Math.round(Number(data.get('bookingDepositAmount') || 0) * 100),
                deposit_reference: depositReference,
                deposit_paid_at: depositPaid ? new Date().toISOString() : null,
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
            bookingEditElement.elements.bookingService.value = record.service_type;
            bookingEditElement.elements.bookingStatus.value = record.status;
            bookingEditElement.elements.bookingScheduledDate.value = record.scheduled_date || '';
            bookingEditElement.elements.bookingScheduledTime.value = record.scheduled_time
                ? String(record.scheduled_time).slice(0, 5)
                : '';
            bookingEditElement.elements.bookingLocation.value = record.location || '';
            bookingEditElement.elements.bookingDepositAmount.value =
                (Number(record.deposit_amount_cents) / 100).toFixed(2);
            bookingEditElement.elements.bookingDepositReference.value = record.deposit_reference || '';
            bookingEditElement.elements.bookingDepositPaid.value = String(Boolean(record.deposit_paid_at));
            bookingEditElement.elements.bookingNotes.value = record.admin_notes || '';
        });
        bookingsSection.append(bookingStatusForm);
        const bookingTablesPanel = makePanel('Booking requests');
        const bookingTables = element('div', 'backend-tables');
        bookingTables.id = 'booking-tables';
        bookingTablesPanel.appendChild(bookingTables);
        bookingsSection.appendChild(bookingTablesPanel);
        const calendarPanel = makePanel('Booking calendar');
        const calendarControls = element('div', 'calendar-controls');
        const calendarFrom = makeField('From', 'bookingCalendarFrom', 'date', {});
        const calendarTo = makeField('To', 'bookingCalendarTo', 'date', {});
        const calendarView = makeField('View', 'bookingCalendarView', 'select', {
            items: [
                { id: 'day', name: 'Daily' },
                { id: 'week', name: 'Weekly' },
                { id: 'month', name: 'Monthly' },
                { id: 'range', name: 'Custom range' }
            ],
            label: function (item) { return item.name; }
        });
        const calendarDate = makeField('Day / week / month', 'bookingCalendarDate', 'date', {});
        const calendarStatus = makeField('Status', 'bookingCalendarStatus', 'select', {
            items: [
                { id: 'all', name: 'All requests' },
                { id: 'confirmed', name: 'Confirmed sessions' },
                { id: 'pending', name: 'Pending requests' }
            ],
            label: function (item) { return item.name; }
        });
        calendarControls.append(calendarView, calendarDate);
        const calendarRefresh = element('button', 'btn btn-outline-primary', 'Apply calendar filter');
        calendarRefresh.type = 'button';
        calendarControls.append(calendarFrom, calendarTo, calendarStatus, calendarRefresh);
        const calendarRows = element('div', 'backend-tables');
        calendarRows.id = 'booking-calendar';
        calendarPanel.append(calendarControls, calendarRows);
        bookingsSection.appendChild(calendarPanel);
        calendarRefresh.addEventListener('click', renderBookingCalendar);
        const bookingHistoryPanel = makePanel('Booking status and scheduling history');
        const bookingHistoryTable = element('div', 'backend-tables');
        bookingHistoryTable.id = 'booking-history-tables';
        bookingHistoryPanel.appendChild(bookingHistoryTable);
        bookingsSection.appendChild(bookingHistoryPanel);

        const bookingServiceForms = element('div', 'backend-form-grid');
        const bookingServiceForm = makeForm('Add photography service', [
            makeField('Service name', 'serviceName', 'text', { required: true, maxLength: 100 }),
            makeField('Standard duration (minutes)', 'serviceDuration', 'number', { required: true, min: 15, max: 1440, step: 15 }),
            makeField('Display order', 'serviceDisplayOrder', 'number', { required: true, min: 0, max: 1000, step: 1 })
        ], async function (data) {
            await window.MCMBackend.admin.create('bookingServices', {
                name: String(data.get('serviceName')).trim(),
                duration_minutes: Number(data.get('serviceDuration')),
                display_order: Number(data.get('serviceDisplayOrder')),
                is_active: true
            });
        });
        const serviceEditForm = makeForm('Update service availability', [
            makeField('Service', 'serviceRecord', 'select', { required: true, items: records.bookingServices, label: function (item) { return item.name; } }),
            makeField('Standard duration (minutes)', 'serviceEditDuration', 'number', { required: true, min: 15, max: 1440, step: 15 }),
            makeField('Display order', 'serviceEditDisplayOrder', 'number', { required: true, min: 0, max: 1000, step: 1 }),
            makeField('Availability', 'serviceEditActive', 'select', {
                required: true,
                items: [{ id: 'true', name: 'Available' }, { id: 'false', name: 'Unavailable' }],
                label: function (item) { return item.name; }
            })
        ], async function (data) {
            await window.MCMBackend.admin.update('bookingServices', data.get('serviceRecord'), {
                duration_minutes: Number(data.get('serviceEditDuration')),
                display_order: Number(data.get('serviceEditDisplayOrder')),
                is_active: String(data.get('serviceEditActive')) === 'true'
            });
        });
        serviceEditForm.id = 'serviceEditForm';
        const serviceEditElement = serviceEditForm.querySelector('form');
        serviceEditElement.elements.serviceRecord.addEventListener('change', function () {
            const service = records.bookingServices.find(function (item) {
                return item.id === serviceEditElement.elements.serviceRecord.value;
            });
            if (!service) return;
            serviceEditElement.elements.serviceEditDuration.value = service.duration_minutes;
            serviceEditElement.elements.serviceEditDisplayOrder.value = service.display_order;
            serviceEditElement.elements.serviceEditActive.value = String(service.is_active);
        });
        bookingServiceForms.append(bookingServiceForm, serviceEditForm);
        bookingsSection.appendChild(bookingServiceForms);

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
            makeField('Cancellation reason (required when cancelling)', 'orderCancellationReason', 'textarea', { maxLength: 1000 }),
            makeField('Admin notes', 'orderEditNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            const orderId = String(data.get('orderRecord'));
            const order = records.orders.find(function (item) { return item.id === orderId; });
            const nextStatus = String(data.get('orderStatus'));
            const cancellationReason = String(data.get('orderCancellationReason') || '').trim();
            if (nextStatus === 'cancelled' && cancellationReason.length < 3) {
                throw new Error('Add a reason before cancelling an order.');
            }
            if (nextStatus === 'complete') {
                const payment = paymentForOrder(orderId);
                if (!payment || payment.status !== 'verified') {
                    throw new Error('Verify the actual payment before completing this order.');
                }
            }
            if (order && order.status === 'cancelled' && nextStatus !== 'cancelled' &&
                !window.confirm('Reopen this cancelled order?')) {
                throw new Error('Order status was not changed.');
            }
            await window.MCMBackend.admin.update('orders', data.get('orderRecord'), {
                status: nextStatus,
                cancellation_reason: nextStatus === 'cancelled' ? cancellationReason : '',
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
            orderEditElement.elements.orderCancellationReason.value = record.cancellation_reason || '';
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

        const paymentForm = makeForm('Record payment and verify bank transaction', [
            makeField('Order', 'paymentOrder', 'select', { required: true, items: records.orders, label: function (item) { return item.order_code + ' — ' + item.status; } }),
            makeField('Payment status', 'paymentStatus', 'select', {
                required: true,
                items: [
                    { id: 'awaiting_payment', name: 'Awaiting payment' },
                    { id: 'proof_reported', name: 'Proof reported as sent' },
                    { id: 'under_verification', name: 'Under verification' },
                    { id: 'verified', name: 'Verified (bank transaction checked)' },
                    { id: 'rejected', name: 'Rejected' },
                    { id: 'refunded', name: 'Refunded' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Amount received (ZAR)', 'paymentAmountReceived', 'number', { required: true, min: 0, max: 999999, step: 0.01 }),
            makeField('Transaction reference', 'paymentReference', 'text', { maxLength: 200 }),
            makeField('Payment channel', 'paymentChannel', 'select', {
                required: true,
                items: [
                    { id: 'bank_transfer', name: 'Bank transfer' },
                    { id: 'cash', name: 'Cash' },
                    { id: 'other', name: 'Other' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Internal payment notes', 'paymentNotes', 'textarea', { maxLength: 5000 })
        ], async function (data) {
            const orderId = String(data.get('paymentOrder'));
            const order = records.orders.find(function (item) { return item.id === orderId; });
            if (!order) throw new Error('Choose an existing order.');
            const statusValue = String(data.get('paymentStatus'));
            const amountCents = Math.round(Number(data.get('paymentAmountReceived')) * 100);
            const paymentReference = String(data.get('paymentReference') || '').trim();
            if (statusValue === 'verified') {
                if (!window.confirm('Confirm you checked the actual bank transaction and received the full order amount? A screenshot or message alone is not verification.')) {
                    throw new Error('Payment was not marked verified.');
                }
                if (amountCents < orderTotalCents(orderId) || paymentReference.length < 3) {
                    throw new Error('Verified payments require the full expected amount and a bank transaction reference.');
                }
            }
            if (statusValue === 'refunded' &&
                !window.confirm('Confirm this previously verified payment has actually been refunded?')) {
                throw new Error('Payment was not marked refunded.');
            }
            await window.MCMBackend.admin.recordPayment(orderId, {
                status: statusValue,
                amountReceivedCents: amountCents,
                paymentReference: paymentReference,
                paymentChannel: String(data.get('paymentChannel')),
                adminNotes: String(data.get('paymentNotes') || '').trim()
            });
        });
        paymentForm.id = 'paymentForm';
        const paymentEditElement = paymentForm.querySelector('form');
        paymentEditElement.prepend(element(
            'p',
            'text-muted',
            'Expected totals are calculated from immutable order-item price snapshots. A screenshot or parent message is not bank verification.'
        ));
        paymentEditElement.elements.paymentOrder.addEventListener('change', function () {
            const orderId = paymentEditElement.elements.paymentOrder.value;
            const payment = paymentForOrder(orderId);
            paymentEditElement.elements.paymentStatus.value = payment ? payment.status : 'awaiting_payment';
            paymentEditElement.elements.paymentAmountReceived.value = payment
                ? (Number(payment.amount_received_cents) / 100).toFixed(2)
                : '0.00';
            paymentEditElement.elements.paymentReference.value = payment ? payment.payment_reference : '';
            paymentEditElement.elements.paymentChannel.value = payment ? payment.payment_channel : 'bank_transfer';
            paymentEditElement.elements.paymentNotes.value = payment ? payment.admin_notes : '';
        });
        ordersSection.appendChild(paymentForm);
        const paymentTablePanel = makePanel('Payment verification queue');
        const paymentTable = element('div', 'backend-tables');
        paymentTable.id = 'payment-tables';
        paymentTablePanel.appendChild(paymentTable);
        ordersSection.appendChild(paymentTablePanel);
        const orderHistoryPanel = makePanel('Order and payment history');
        const orderHistoryTable = element('div', 'backend-tables');
        orderHistoryTable.id = 'order-history-tables';
        orderHistoryPanel.appendChild(orderHistoryTable);
        ordersSection.appendChild(orderHistoryPanel);
        const downloadPanel = makePanel('Digital photo download approvals');
        const downloadTable = element('div', 'backend-tables');
        downloadTable.id = 'download-tables';
        downloadPanel.appendChild(downloadTable);
        ordersSection.appendChild(downloadPanel);

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
                    { id: 'awaiting_outsourced_product', name: 'Awaiting outsourced product' },
                    { id: 'quality_check', name: 'Quality check' },
                    { id: 'ready', name: 'Ready' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Delivery status', 'deliveryStatus', 'select', {
                required: true,
                items: [
                    { id: 'not_started', name: 'Not started' },
                    { id: 'awaiting_dispatch', name: 'Awaiting dispatch' },
                    { id: 'ready_for_collection', name: 'Ready for collection' },
                    { id: 'dispatched', name: 'Dispatched' },
                    { id: 'collected', name: 'Collected' },
                    { id: 'delivered', name: 'Delivered' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Delivery / collection date', 'deliveryDate', 'date', {}),
            makeField('Production instructions', 'productionInstructions', 'textarea', { maxLength: 2000 }),
            makeField('Delivery notes', 'deliveryNotes', 'textarea', { maxLength: 2000 })
        ], async function (data) {
            const orderId = String(data.get('productionOrder'));
            const order = records.orders.find(function (item) { return item.id === orderId; });
            const productionStatus = String(data.get('productionStatus'));
            const deliveryStatus = String(data.get('deliveryStatus'));
            if (order && order.production_status === 'ready' &&
                productionStatus !== 'ready' && order.delivery_status !== 'not_started' &&
                !window.confirm('Production is already marked ready and delivery is underway. Reopen production?')) {
                throw new Error('Production status was not changed.');
            }
            await window.MCMBackend.admin.update('orders', data.get('productionOrder'), {
                production_status: productionStatus,
                delivery_status: deliveryStatus,
                production_instructions: String(data.get('productionInstructions') || '').trim(),
                delivery_date: data.get('deliveryDate') || null,
                delivery_notes: String(data.get('deliveryNotes') || '').trim()
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
            productionEditElement.elements.deliveryDate.value = record.delivery_date || '';
            productionEditElement.elements.productionInstructions.value = record.production_instructions || '';
            productionEditElement.elements.deliveryNotes.value = record.delivery_notes || '';
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
        const settingsForm = makeForm('Business, availability and gallery settings', [
            makeField('Business name', 'settingsBusinessName', 'text', { required: true, maxLength: 160 }),
            makeField('Business email', 'settingsBusinessEmail', 'email', { maxLength: 254 }),
            makeField('Contact phone', 'settingsPhone', 'tel', { maxLength: 40 }),
            makeField('Business address', 'settingsAddress', 'text', { maxLength: 500 }),
            makeField('Working days', 'settingsWorkingDays', 'select', {
                required: true,
                multiple: true,
                items: [
                    { id: '1', name: 'Monday' },
                    { id: '2', name: 'Tuesday' },
                    { id: '3', name: 'Wednesday' },
                    { id: '4', name: 'Thursday' },
                    { id: '5', name: 'Friday' },
                    { id: '6', name: 'Saturday' },
                    { id: '0', name: 'Sunday' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Workday starts', 'settingsWorkdayStart', 'time', { required: true }),
            makeField('Workday ends', 'settingsWorkdayEnd', 'time', { required: true }),
            makeField('Booking lead time (days)', 'settingsBookingLeadDays', 'number', { required: true, min: 0, max: 365, step: 1 }),
            makeField('Watermark text', 'settingsWatermarkText', 'text', { required: true, min: 1, maxLength: 80 }),
            makeField('Watermark opacity (0.10–1.00)', 'settingsWatermarkOpacity', 'number', { required: true, min: 0.1, max: 1, step: 0.05 }),
            makeField('Watermark position', 'settingsWatermarkPosition', 'select', {
                required: true,
                items: [
                    { id: 'center', name: 'Center' },
                    { id: 'bottom-left', name: 'Bottom left' },
                    { id: 'bottom-right', name: 'Bottom right' }
                ],
                label: function (item) { return item.name; }
            }),
            makeField('Preview image quality', 'settingsPreviewQuality', 'number', { required: true, min: 40, max: 90, step: 1 }),
            makeField('Preview maximum width (pixels)', 'settingsPreviewWidth', 'number', { required: true, min: 640, max: 2400, step: 1 }),
            makeField('Digital download policy', 'settingsDownloadPolicy', 'select', {
                required: true,
                items: [
                    { id: 'manual', name: 'Always require manual approval' },
                    { id: 'paid', name: 'Allow after payment verification' },
                    { id: 'disabled', name: 'Disable digital downloads' }
                ],
                label: function (item) { return item.name; }
            })
        ], async function (data) {
            const start = String(data.get('settingsWorkdayStart'));
            const end = String(data.get('settingsWorkdayEnd'));
            if (start >= end) throw new Error('Workday end must be later than its start.');
            const workingDays = data.getAll('settingsWorkingDays').map(Number);
            if (!workingDays.length) throw new Error('Select at least one working day.');
            const settingRecord = records.studioSettings[0] || {};
            await window.MCMBackend.admin.upsert('studioSettings', {
                id: settingRecord.id,
                singleton: true,
                business_name: String(data.get('settingsBusinessName')).trim(),
                business_email: String(data.get('settingsBusinessEmail') || '').trim(),
                contact_phone: String(data.get('settingsPhone') || '').trim(),
                business_address: String(data.get('settingsAddress') || '').trim(),
                working_days: workingDays,
                working_day_start: start,
                working_day_end: end,
                booking_lead_days: Number(data.get('settingsBookingLeadDays')),
                watermark_text: String(data.get('settingsWatermarkText')).trim(),
                watermark_opacity: Number(data.get('settingsWatermarkOpacity')),
                watermark_position: String(data.get('settingsWatermarkPosition')),
                preview_quality: Number(data.get('settingsPreviewQuality')),
                preview_max_width: Number(data.get('settingsPreviewWidth')),
                download_policy: String(data.get('settingsDownloadPolicy'))
            }, 'singleton');
        });
        settingsForm.id = 'settingsForm';
        settingsSection.appendChild(settingsForm);
        const accountNote = element(
            'p',
            'text-muted',
            'This dashboard is restricted to accounts explicitly granted the administrator role. Staff roles and public registration are not enabled.'
        );
        settingsSection.appendChild(accountNote);
        const inviteAdminForm = makeForm('Invite an administrator', [
            makeField('Administrator email', 'inviteAdminEmail', 'email', { required: true, maxLength: 254 })
        ], async function (data) {
            const result = await window.MCMBackend.admin.manageAdminUsers('invite', {
                email: String(data.get('inviteAdminEmail')).trim()
            });
            setStatus('Administrator invitation sent to ' + result.email + '.');
            await refreshAdminUsers();
        });
        settingsSection.appendChild(inviteAdminForm);
        const adminUsersPanel = makePanel('Administrator access');
        const adminUsersStatus = element('p', 'text-muted');
        adminUsersStatus.id = 'admin-user-status';
        adminUsersStatus.setAttribute('aria-live', 'polite');
        adminUsersPanel.appendChild(adminUsersStatus);
        const adminUsersTable = element('div', 'backend-tables');
        adminUsersTable.id = 'admin-user-table';
        adminUsersPanel.appendChild(adminUsersTable);
        settingsSection.appendChild(adminUsersPanel);

        updateDataSelectors();
        bindWorkspaceControls();
        activateSection(activeSection);
        setStatus('Loading live admin data…');
        refreshData().catch(function (error) {
            setStatus(error.message || 'Unable to load admin data.', true);
        });
        refreshAdminUsers().catch(function (error) {
            adminUsersStatus.textContent = 'Administrator account management is unavailable: ' +
                (error.message || 'Check the admin-manage-users function deployment.');
            adminUsersStatus.classList.add('is-error');
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
        const optionalCollections = await Promise.all([
            'content',
            'bookings',
            'orders',
            'orderItems',
            'bookingServices',
            'studioSettings',
            'guardians',
            'learnerGuardians',
            'photoBatches',
            'payments',
            'bookingHistory',
            'orderHistory',
            'paymentHistory',
            'downloadRequests'
        ].map(async function (name) {
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
        populateSettingsForm();
        renderWorkspaceTables();
        renderOverview();
        renderBookingCalendar();
        const unavailable = optionalCollections.filter(function (result) { return result.error; });
        if (unavailable.length) {
            setStatus('Some workflow data is unavailable: ' +
                unavailable.map(function (result) {
                    return result.name + ' (' + result.error.message + ')';
                }).join('; ') + '. Check the incremental migration, RLS and connectivity.', true);
        } else {
            setStatus('Admin data loaded: ' + [
                records.schools.length + ' schools',
                records.projects.length + ' projects',
                records.learners.length + ' learners',
                records.photos.length + ' photos',
                records.bookings.length + ' bookings',
                records.orders.length + ' orders'
            ].join(', ') + '. Empty sections are shown as “No records yet”.');
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
        const paymentContainer = document.getElementById('payment-tables');
        const orderHistoryContainer = document.getElementById('order-history-tables');
        const downloadContainer = document.getElementById('download-tables');
        const bookingHistoryContainer = document.getElementById('booking-history-tables');
        if (schoolContainer) schoolContainer.replaceChildren(
            makeTable('Schools', ['Name', 'Slug', 'Contact', 'Status'], records.schools, function (item) {
            return [item.name, item.slug, item.contact_email || item.phone, item.is_active ? 'Active' : 'Inactive'];
        }, {
            collection: 'schools',
            label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
            changes: function (item) { return { is_active: !item.is_active }; },
            success: 'School status updated.'
        }),
            makeTable('Projects', ['Project', 'School', 'Year', 'Photography dates', 'Status'], records.projects, function (item) {
            const school = records.schools.find(function (record) { return record.id === item.school_id; });
            return [
                item.name,
                school ? school.name : '—',
                item.school_year,
                [item.photography_start_date, item.photography_end_date].filter(Boolean).join(' – ') || 'Not scheduled',
                item.status
            ];
        }, {
            collection: 'projects',
            label: function (item) { return item.status === 'active' ? 'Pause' : 'Activate'; },
            changes: function (item) { return { status: item.status === 'active' ? 'draft' : 'active' }; },
            success: 'Project status updated.'
        }),
            makeTable('Classes', ['Class', 'Project', 'Learners'], records.classes, function (item) {
            const project = records.projects.find(function (record) { return record.id === item.project_id; });
            const learnerCount = records.learners.filter(function (learner) { return learner.class_id === item.id; }).length;
            return [item.name, project ? project.name : '—', learnerCount];
        }),
            makeTable('Learners', ['Name', 'Reference code', 'Class', 'Photo consent', 'Photos', 'Guardians'], records.learners, function (item) {
            const schoolClass = records.classes.find(function (record) { return record.id === item.class_id; });
            const photoCount = records.photos.filter(function (photo) { return photo.learner_id === item.id && !photo.is_archived; }).length;
            const guardianLinks = records.learnerGuardians.filter(function (link) { return link.learner_id === item.id; });
            const guardianNames = guardianLinks.map(function (link) {
                const guardian = records.guardians.find(function (record) { return record.id === link.guardian_id; });
                return guardian ? guardian.full_name : '';
            }).filter(Boolean).join(', ');
            return [
                item.display_name,
                item.reference_code,
                schoolClass ? schoolClass.name : '—',
                item.consent_status,
                photoCount,
                guardianNames || 'None linked'
            ];
        }, {
            collection: 'learners',
            label: function (item) { return item.is_active ? 'Deactivate' : 'Activate'; },
            changes: function (item) { return { is_active: !item.is_active }; },
            success: 'Learner status updated.',
            actions: function (item) {
                return [{
                    label: 'Access QR',
                    success: 'Learner access QR code generated.',
                    run: async function () {
                        if (!window.QRCode || typeof window.QRCode.toDataURL !== 'function') {
                            throw new Error('The QR code generator did not load. Check the network connection and try again.');
                        }
                        if (!learnerQrDialog || !learnerQrImage || !learnerQrDownload) {
                            throw new Error('The learner QR preview is unavailable.');
                        }
                        const accessUrl = new URL('../parents/school-access.html', window.location.href);
                        accessUrl.searchParams.set('reference', item.reference_code);
                        learnerQrImage.src = await window.QRCode.toDataURL(accessUrl.href, {
                            width: 360,
                            margin: 2,
                            errorCorrectionLevel: 'M'
                        });
                        learnerQrDownload.href = learnerQrImage.src;
                        learnerQrDownload.download = 'mcm-access-' + item.reference_code + '.png';
                        learnerQrDialog.showModal();
                    }
                }];
            }
        })
        );
        if (photoContainer) photoContainer.replaceChildren(
            makeTable('Photos', ['Title', 'Project', 'Batch', 'Learner', 'Price', 'State'], records.photos, function (item) {
                const learner = records.learners.find(function (record) { return record.id === item.learner_id; });
                const project = records.projects.find(function (record) { return record.id === item.project_id; });
                const batch = records.photoBatches.find(function (record) { return record.id === item.batch_id; });
                const assignment = item.is_archived ? 'Archived' :
                    (!item.learner_id ? 'Awaiting assignment' :
                        (item.is_published ? 'Published' : 'Assigned / draft'));
                return [
                    item.title,
                    project ? project.name : '—',
                    batch ? batch.label : '—',
                    learner ? learner.display_name + ' (' + learner.reference_code + ')' : 'Unassigned',
                    formatCurrency(item.price_cents),
                    assignment
                ];
            }, {
                collection: 'photos',
                label: function (item) {
                    if (item.is_archived) return 'Archived';
                    return item.is_published ? 'Unpublish' : 'Publish';
                },
                disabled: function (item) {
                    if (item.is_archived) return true;
                    if (item.is_published) return false;
                    const learner = records.learners.find(function (record) { return record.id === item.learner_id; });
                    return !item.learner_id || !item.preview_storage_path ||
                        !learner || !learner.is_active || learner.consent_status !== 'approved';
                },
                changes: function (item) { return { is_published: !item.is_published }; },
                confirm: function (item) {
                    return item.is_published
                        ? 'Remove this photograph from the parent gallery?'
                        : 'Publish the watermarked preview to the approved learner gallery?';
                },
                success: 'Photo visibility updated.',
                actions: function (item) {
                    const actions = [];
                    if (!item.preview_storage_path && item.storage_path && !item.is_archived) {
                        actions.push({
                            label: 'Generate preview',
                            success: 'Private watermarked preview generated.',
                            run: async function () {
                                const storage = window.MCMBackend.getClient().storage.from('learner-photos');
                                const original = await storage.download(item.storage_path);
                                if (original.error || !original.data) {
                                    throw original.error || new Error('Unable to read the private original photo.');
                                }
                                const file = new File([original.data], item.title + '.jpg', {
                                    type: original.data.type || 'image/jpeg'
                                });
                                const preview = await createWatermarkedPreview(file, records.studioSettings[0] || {});
                                const previewPath = 'previews/' + item.id + '-' + crypto.randomUUID() + '.jpg';
                                const uploaded = await storage.upload(previewPath, preview, {
                                    contentType: 'image/jpeg',
                                    upsert: false
                                });
                                if (uploaded.error) throw uploaded.error;
                                try {
                                    await window.MCMBackend.admin.update('photos', item.id, {
                                        preview_storage_path: previewPath
                                    });
                                } catch (error) {
                                    const cleanup = await storage.remove([previewPath]);
                                    if (cleanup.error) {
                                        throw new Error(error.message + ' The unused preview could not be removed; contact an administrator.');
                                    }
                                    throw error;
                                }
                            }
                        });
                    }
                    if (item.preview_storage_path && !item.is_archived) {
                        actions.push({
                            label: 'Preview',
                            success: 'Private preview opened.',
                            run: async function () {
                                const signed = await window.MCMBackend.getClient()
                                    .storage.from('learner-photos')
                                    .createSignedUrl(item.preview_storage_path, 300);
                                if (signed.error || !signed.data || !signed.data.signedUrl) {
                                    throw signed.error || new Error('Unable to prepare a private photo preview.');
                                }
                                if (!photoPreviewDialog || !photoPreviewImage) {
                                    throw new Error('The photo preview is unavailable.');
                                }
                                photoPreviewImage.src = signed.data.signedUrl;
                                photoPreviewDialog.showModal();
                            }
                        });
                    }
                    if (!item.is_archived) {
                        actions.push({
                            label: 'Archive',
                            success: 'Photo archived.',
                            run: async function () {
                                if (!window.confirm('Archive this photograph? It will be unpublished and excluded from orders.')) {
                                    throw new Error('Photo was not archived.');
                                }
                                return window.MCMBackend.admin.update('photos', item.id, {
                                    is_published: false,
                                    is_archived: true
                                });
                            }
                        });
                    }
                    return actions;
                }
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
        if (bookingContainer) {
            const bookingPanel = makePanel('All booking requests');
            const exportBookings = element('button', 'btn btn-outline-primary btn-sm', 'Export bookings CSV');
            exportBookings.type = 'button';
            exportBookings.addEventListener('click', function () {
                exportCsv('mcm-bookings.csv',
                    ['Reference', 'Client', 'Phone', 'Email', 'Service', 'Requested date', 'Preferred time', 'Scheduled date', 'Scheduled time', 'Location', 'Status', 'Notes'],
                    records.bookings.map(function (item) {
                        return [
                            item.booking_code, item.client_name, item.phone, item.email,
                            item.service_type, item.preferred_date, item.preferred_time,
                            item.scheduled_date, item.scheduled_time, item.location,
                            item.status, item.admin_notes
                        ];
                    }));
            });
            bookingPanel.querySelector('.panel-header').appendChild(exportBookings);
            bookingPanel.appendChild(makeTable(
                'Bookings',
                ['Reference', 'Client', 'Phone', 'Email', 'Service', 'Requested', 'Scheduled', 'Location', 'Status'],
                records.bookings.slice().sort(function (left, right) {
                    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
                }),
                function (item) {
                    return [
                        item.booking_code,
                        item.client_name,
                        item.phone,
                        item.email,
                        item.service_type,
                        [item.preferred_date, item.preferred_time].filter(Boolean).join(' '),
                        [item.scheduled_date, item.scheduled_time].filter(Boolean).join(' '),
                        item.location,
                        item.status
                    ];
                }
            ));
            bookingContainer.replaceChildren(bookingPanel);
        }
        if (bookingHistoryContainer) {
            const historyRows = records.bookingHistory.slice().sort(function (left, right) {
                return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
            });
            bookingHistoryContainer.replaceChildren(makeTable(
                'Booking changes',
                ['Reference', 'Previous status', 'New status', 'Scheduled', 'Administrator', 'Notes', 'Date'],
                historyRows,
                function (history) {
                    const booking = records.bookings.find(function (item) { return item.id === history.booking_id; });
                    return [
                        booking ? booking.booking_code : history.booking_id,
                        history.old_status || 'New request',
                        history.new_status,
                        [history.scheduled_date, history.scheduled_time].filter(Boolean).join(' '),
                        history.actor_id || 'Public request',
                        history.notes,
                        new Date(history.created_at).toLocaleString()
                    ];
                }
            ));
        }
        const orderItemsByOrder = {};
        records.orderItems.forEach(function (item) {
            orderItemsByOrder[item.order_id] = (orderItemsByOrder[item.order_id] || 0) + 1;
        });
        const learnerById = {};
        records.learners.forEach(function (learner) {
            learnerById[learner.id] = learner.display_name + ' (' + learner.reference_code + ')';
        });
        const projectById = {};
        records.projects.forEach(function (project) { projectById[project.id] = project; });
        const classById = {};
        records.classes.forEach(function (schoolClass) { classById[schoolClass.id] = schoolClass; });
        const schoolById = {};
        records.schools.forEach(function (school) { schoolById[school.id] = school; });
        const orderRows = records.orders.slice().sort(function (left, right) {
            return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        });
        const orderTable = makeTable('Order requests', ['Reference', 'Learner', 'School / project', 'Items', 'Amount', 'Payment', 'Order status', 'Production', 'Delivery', 'Date'], orderRows, function (item) {
            const learner = records.learners.find(function (record) { return record.id === item.learner_id; });
            const schoolClass = learner && classById[learner.class_id];
            const project = schoolClass && projectById[schoolClass.project_id];
            const school = project && schoolById[project.school_id];
            const payment = paymentForOrder(item.id);
            const lineItems = records.orderItems.filter(function (line) { return line.order_id === item.id; })
                .map(function (line) { return line.title_snapshot; }).join(', ');
            return [
                item.order_code,
                learnerById[item.learner_id] || 'Learner record',
                [school && school.name, project && project.name].filter(Boolean).join(' / ') || '—',
                lineItems || String(orderItemsByOrder[item.id] || 0) + ' items',
                formatCurrency(orderTotalCents(item.id)),
                payment ? payment.status.replace(/_/g, ' ') : 'Awaiting payment',
                item.status,
                item.production_status.replace(/_/g, ' '),
                item.delivery_status.replace(/_/g, ' '),
                new Date(item.created_at).toLocaleDateString()
            ];
        });
        if (orderContainer) orderContainer.replaceChildren(orderTable);
        if (productionContainer) {
            const productionPanel = makePanel('Production and delivery queue');
            productionPanel.appendChild(makeTable(
                'Fulfilment',
                ['Reference', 'Learner', 'School / project', 'Payment', 'Production', 'Delivery', 'Delivery date', 'Created'],
                orderRows,
                function (item) {
                const learner = records.learners.find(function (record) { return record.id === item.learner_id; });
                const schoolClass = learner && classById[learner.class_id];
                const project = schoolClass && projectById[schoolClass.project_id];
                const school = project && schoolById[project.school_id];
                const payment = paymentForOrder(item.id);
                return [
                    item.order_code,
                    learnerById[item.learner_id] || 'Learner record',
                    [school && school.name, project && project.name].filter(Boolean).join(' / ') || '—',
                    payment ? payment.status.replace(/_/g, ' ') : 'Awaiting payment',
                    item.production_status.replace(/_/g, ' '),
                    item.delivery_status.replace(/_/g, ' '),
                    item.delivery_date || '—',
                    new Date(item.created_at).toLocaleDateString()
                ];
                }
            ));
            const reportMap = {};
            orderRows.forEach(function (order) {
                const learner = records.learners.find(function (record) { return record.id === order.learner_id; });
                const schoolClass = learner && classById[learner.class_id];
                const project = schoolClass && projectById[schoolClass.project_id];
                const school = project && schoolById[project.school_id];
                const key = (school ? school.name : 'Unknown school') + ' / ' +
                    (project ? project.name : 'Unknown project');
                if (!reportMap[key]) {
                    reportMap[key] = { scope: key, orders: 0, total_cents: 0, in_production: 0, outstanding_deliveries: 0 };
                }
                reportMap[key].orders += 1;
                reportMap[key].total_cents += orderTotalCents(order.id);
                if (order.production_status !== 'pending' && order.production_status !== 'ready') {
                    reportMap[key].in_production += 1;
                }
                if (order.delivery_status !== 'delivered' && order.delivery_status !== 'collected') {
                    reportMap[key].outstanding_deliveries += 1;
                }
            });
            const reportRows = Object.keys(reportMap).sort().map(function (key) { return reportMap[key]; });
            const reportPanel = makePanel('Operational reports by school and project');
            const reportExport = element('button', 'btn btn-outline-primary btn-sm', 'Export reports CSV');
            reportExport.type = 'button';
            reportExport.addEventListener('click', function () {
                exportCsv('mcm-school-fulfilment-report.csv',
                    ['School / project', 'Orders', 'Order value ZAR', 'In production', 'Outstanding deliveries'],
                    reportRows.map(function (row) {
                        return [
                            row.scope,
                            row.orders,
                            (row.total_cents / 100).toFixed(2),
                            row.in_production,
                            row.outstanding_deliveries
                        ];
                    }));
            });
            reportPanel.querySelector('.panel-header').appendChild(reportExport);
            reportPanel.appendChild(makeTable(
                'School / project summary',
                ['School / project', 'Orders', 'Order value', 'In production', 'Outstanding deliveries'],
                reportRows,
                function (row) {
                    return [
                        row.scope,
                        row.orders,
                        formatCurrency(row.total_cents),
                        row.in_production,
                        row.outstanding_deliveries
                    ];
                }
            ));
            productionPanel.appendChild(reportPanel);
            productionContainer.replaceChildren(productionPanel);
        }
        if (paymentContainer) paymentContainer.replaceChildren(
            makeTable(
                'Orders awaiting payment action',
                ['Order', 'Expected', 'Received', 'Reference', 'Channel', 'Status', 'Updated'],
                records.orders.filter(function (order) {
                    const payment = paymentForOrder(order.id);
                    return !payment || !['verified', 'refunded'].includes(payment.status);
                }),
                function (order) {
                    const payment = paymentForOrder(order.id);
                    return [
                        order.order_code,
                        formatCurrency(payment ? payment.expected_amount_cents : orderTotalCents(order.id)),
                        formatCurrency(payment ? payment.amount_received_cents : 0),
                        payment ? payment.payment_reference : '—',
                        payment ? payment.payment_channel.replace(/_/g, ' ') : '—',
                        payment ? payment.status.replace(/_/g, ' ') : 'awaiting payment',
                        payment ? new Date(payment.updated_at).toLocaleDateString() : '—'
                    ];
                }
            ),
            makeTable(
                'All recorded payments',
                ['Order', 'Expected', 'Received', 'Reference', 'Channel', 'Status', 'Verified by', 'Verified at'],
                records.payments,
                function (payment) {
                    const order = records.orders.find(function (item) { return item.id === payment.order_id; });
                    return [
                        order ? order.order_code : payment.order_id,
                        formatCurrency(payment.expected_amount_cents),
                        formatCurrency(payment.amount_received_cents),
                        payment.payment_reference,
                        payment.payment_channel.replace(/_/g, ' '),
                        payment.status.replace(/_/g, ' '),
                        payment.verified_by_email || payment.verified_by || '—',
                        payment.verified_at ? new Date(payment.verified_at).toLocaleString() : '—'
                    ];
                }
            )
        );
        if (orderHistoryContainer) {
            const orderHistoryRows = records.orderHistory.map(function (history) {
                return {
                    reference: (records.orders.find(function (order) { return order.id === history.order_id; }) || {}).order_code || history.order_id,
                    category: 'Order / fulfilment',
                    status: [history.new_status, history.new_production_status, history.new_delivery_status]
                        .filter(Boolean).join(' / '),
                    actor: history.actor_id || '—',
                    notes: history.notes,
                    created_at: history.created_at
                };
            }).concat(records.paymentHistory.map(function (history) {
                const payment = records.payments.find(function (item) { return item.id === history.payment_id; });
                const order = payment && records.orders.find(function (item) { return item.id === payment.order_id; });
                return {
                    reference: order ? order.order_code : 'Payment',
                    category: 'Payment',
                    status: history.new_status,
                    actor: history.actor_id || '—',
                    notes: history.notes || history.payment_reference,
                    created_at: history.created_at
                };
            })).sort(function (left, right) {
                return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
            });
            const exportOrders = element('button', 'btn btn-outline-primary btn-sm', 'Export orders CSV');
            exportOrders.type = 'button';
            exportOrders.addEventListener('click', function () {
                exportCsv('mcm-orders.csv',
                    ['Order reference', 'Learner', 'Source', 'Items', 'Total ZAR', 'Payment status', 'Production status', 'Delivery status', 'Created'],
                    orderRows.map(function (order) {
                        const payment = paymentForOrder(order.id);
                        return [
                            order.order_code,
                            learnerById[order.learner_id],
                            order.source,
                            records.orderItems.filter(function (item) { return item.order_id === order.id; })
                                .map(function (item) { return item.title_snapshot; }).join('; '),
                            (orderTotalCents(order.id) / 100).toFixed(2),
                            payment ? payment.status : 'awaiting_payment',
                            order.production_status,
                            order.delivery_status,
                            order.created_at
                        ];
                    }));
            });
            const historyPanel = makePanel('Order and payment history');
            historyPanel.querySelector('.panel-header').appendChild(exportOrders);
            historyPanel.appendChild(makeTable(
                'Order status, production, delivery and payment history',
                ['Order', 'Event', 'Status', 'Administrator', 'Notes', 'Date'],
                orderHistoryRows,
                function (entry) {
                    return [entry.reference, entry.category, entry.status, entry.actor, entry.notes, new Date(entry.created_at).toLocaleString()];
                }
            ));
            orderHistoryContainer.replaceChildren(historyPanel);
        }
        if (downloadContainer) {
            const requests = records.downloadRequests.slice().sort(function (left, right) {
                return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
            });
            downloadContainer.replaceChildren(makeTable(
                'Photo download requests',
                ['Order', 'Learner', 'Photo', 'Status', 'Downloads', 'Requested'],
                requests,
                function (request) {
                    const order = records.orders.find(function (item) { return item.id === request.order_id; });
                    const learner = records.learners.find(function (item) { return item.id === request.learner_id; });
                    const photo = records.photos.find(function (item) { return item.id === request.photo_id; });
                    return [
                        order ? order.order_code : request.order_id,
                        learner ? learner.display_name + ' (' + learner.reference_code + ')' : '—',
                        photo ? photo.title : '—',
                        request.status,
                        request.download_count + ' / 5',
                        new Date(request.created_at).toLocaleString()
                    ];
                },
                {
                    hideStatus: true,
                    actions: function (request) {
                        if (request.status !== 'pending') return [];
                        return [
                            {
                                label: 'Approve',
                                success: 'Photo download approved.',
                                run: async function () {
                                    if (!window.confirm('Approve this download? Verify that the order payment is confirmed in the bank.')) {
                                        throw new Error('Download request was not approved.');
                                    }
                                    return window.MCMBackend.admin.reviewDownloadRequest(request.id, true);
                                }
                            },
                            {
                                label: 'Reject',
                                success: 'Photo download rejected.',
                                run: async function () {
                                    if (!window.confirm('Reject this photo download request?')) {
                                        throw new Error('Download request was not rejected.');
                                    }
                                    return window.MCMBackend.admin.reviewDownloadRequest(request.id, false);
                                }
                            }
                        ];
                    }
                }
            ));
        }
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
