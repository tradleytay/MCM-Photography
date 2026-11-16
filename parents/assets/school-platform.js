(function () {
    'use strict';

    const selectionKey = 'mcm-parent-order-selection';
    const selection = loadSelection();
    let galleryPhotos = [];
    let activePackages = [];
    let downloadOrders = [];

    function loadSelection() {
        try {
            const value = JSON.parse(window.sessionStorage.getItem(selectionKey) || '{}');
            return {
                photoIds: new Set(Array.isArray(value.photoIds) ? value.photoIds.filter(function (id) {
                    return typeof id === 'string';
                }) : []),
                packageIds: new Set(Array.isArray(value.packageIds) ? value.packageIds.filter(function (id) {
                    return typeof id === 'string';
                }) : [])
            };
        } catch (error) {
            window.sessionStorage.removeItem(selectionKey);
            return { photoIds: new Set(), packageIds: new Set() };
        }
    }

    function saveSelection() {
        window.sessionStorage.setItem(selectionKey, JSON.stringify({
            photoIds: Array.from(selection.photoIds),
            packageIds: Array.from(selection.packageIds)
        }));
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function money(cents) {
        return new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR'
        }).format((Number(cents) || 0) / 100);
    }

    function showNotice(target, message, tone) {
        if (!target) return null;
        let notice = target.querySelector('[data-backend-status]');
        if (!notice) {
            notice = element('div');
            notice.setAttribute('data-backend-status', '');
            notice.setAttribute('role', 'status');
            target.insertBefore(notice, target.firstChild);
        }
        notice.className = 'alert ' + (tone || 'alert-warning') + ' mb-4';
        notice.textContent = message;
        return notice;
    }

    function setFormStatus(form, message, isError) {
        const status = form.querySelector('[data-access-status]');
        if (status) {
            status.textContent = message;
            status.classList.toggle('text-danger', Boolean(isError));
            status.classList.toggle('text-success', Boolean(message) && !isError);
        }
    }

    function setFormDisabled(form, disabled) {
        if (!form) return;
        form.querySelectorAll('input, select, textarea, button').forEach(function (control) {
            control.disabled = disabled;
        });
    }

    function connectAccessForm(form) {
        setFormDisabled(form, false);
        const reference = new URLSearchParams(window.location.search).get('reference');
        if (reference && /^[A-Za-z0-9-]{4,40}$/.test(reference)) {
            form.elements.learnerRef.value = reference.toUpperCase();
            form.elements.pin.focus();
        }
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (!form.reportValidity()) return;

            const submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            setFormStatus(form, 'Verifying secure access…', false);
            try {
                await window.MCMBackend.parent.access(form.elements.learnerRef.value.trim(), form.elements.pin.value);
                form.elements.pin.value = '';
                window.location.assign('school-gallery.html');
            } catch (error) {
                form.elements.pin.value = '';
                setFormStatus(form, error.message || 'Unable to verify access. Try again later.', true);
                submit.disabled = false;
            }
        });
    }

    function setLearnerSummary(learner) {
        const name = document.querySelector('[data-learner-name]');
        const reference = document.querySelector('[data-gallery-reference]');
        const school = document.querySelector('[data-gallery-school]');
        const grade = document.querySelector('[data-gallery-grade]');
        if (name) name.textContent = learner.name;
        if (reference) reference.textContent = 'Private access';
        if (school) school.textContent = learner.school;
        if (grade) grade.textContent = learner.className;
    }

    function appendAccessLink(notice) {
        if (!notice) return;
        const link = document.createElement('a');
        link.href = 'school-access.html';
        link.textContent = 'Return to Parent Access';
        notice.append(' ', link);
    }

    function renderPackageCards(container, packages, compact) {
        if (!container) return;
        container.replaceChildren();
        if (!packages.length) {
            container.appendChild(element('p', 'text-muted', 'No active packages are available right now.'));
            return;
        }
        packages.forEach(function (item) {
            const card = element('article', compact ? 'package-card package-card--compact' : 'package-card');
            card.append(
                element('h3', '', item.name),
                element('p', 'package-price', money(item.price_cents)),
                element('p', '', item.description || 'Photography package')
            );
            if (!compact) {
                const label = element('label', 'form-check d-flex align-items-center gap-2');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'form-check-input m-0';
                checkbox.checked = selection.packageIds.has(item.id);
                checkbox.addEventListener('change', function () {
                    if (checkbox.checked && !selection.packageIds.has(item.id) && selection.packageIds.size >= 10) {
                        checkbox.checked = false;
                        showNotice(container.parentElement, 'A request can include up to 10 packages.', 'alert-warning');
                        return;
                    }
                    if (checkbox.checked) selection.packageIds.add(item.id);
                    else selection.packageIds.delete(item.id);
                    saveSelection();
                    renderCart();
                });
                label.append(checkbox, element('span', '', 'Add this package to your request'));
                card.appendChild(label);
            }
            container.appendChild(card);
        });
    }

    function updateSelectionCount() {
        const selected = document.querySelector('[data-selected-count]');
        if (selected) selected.textContent = String(selection.photoIds.size + selection.packageIds.size);
    }

    function renderCart() {
        const cart = document.querySelector('[data-cart-items]');
        const cartSummary = document.querySelector('[data-cart-summary]');
        const storeSummary = document.querySelector('[data-store-summary]');
        const checkoutSummary = document.querySelector('[data-checkout-summary]');
        const selectedPhotos = galleryPhotos.filter(function (photo) {
            return selection.photoIds.has(photo.id);
        });
        const selectedPackages = activePackages.filter(function (item) {
            return selection.packageIds.has(item.id);
        });
        const total = selectedPackages.reduce(function (sum, item) {
            return sum + Number(item.price_cents || 0);
        }, 0);

        if (cart) {
            cart.replaceChildren();
            const selectedItems = selectedPhotos.map(function (item) {
                return { id: item.id, type: 'photo', title: item.title };
            }).concat(selectedPackages.map(function (item) {
                return { id: item.id, type: 'package', title: item.name, price: item.price_cents };
            }));
            if (!selectedItems.length) {
                cart.appendChild(element('p', 'text-muted', 'Choose photos or packages from your gallery to build an order request.'));
            } else {
                selectedItems.forEach(function (item) {
                    const row = element('div', 'cart-item d-flex justify-content-between align-items-center gap-3');
                    const copy = document.createElement('div');
                    copy.append(element('strong', '', item.title), element('small', 'd-block text-muted', item.type === 'photo' ? 'Selected photograph' : 'Package'));
                    row.appendChild(copy);
                    if (item.type === 'package') row.appendChild(element('span', '', money(item.price)));
                    const remove = element('button', 'btn btn-sm btn-outline-secondary', 'Remove');
                    remove.type = 'button';
                    remove.addEventListener('click', function () {
                        (item.type === 'photo' ? selection.photoIds : selection.packageIds).delete(item.id);
                        saveSelection();
                        renderGalleryCards();
                        renderPackageCards(document.querySelector('[data-store-packages]'), activePackages, false);
                        renderCart();
                    });
                    row.appendChild(remove);
                    cart.appendChild(row);
                });
            }
        }

        [cartSummary, storeSummary, checkoutSummary].forEach(function (summary) {
            if (!summary) return;
            summary.replaceChildren(
                element('h3', '', 'Order request summary'),
                element('p', '', selectedPhotos.length + ' photo' + (selectedPhotos.length === 1 ? '' : 's')),
                element('p', '', selectedPackages.length + ' package' + (selectedPackages.length === 1 ? '' : 's')),
                element('p', 'mb-2', 'Package estimate: ' + money(total)),
                element('p', 'small text-muted mb-0', 'No payment is taken online. MCM Photography will confirm the order and payment arrangements.')
            );
        });
        updateSelectionCount();
    }

    function renderGalleryCards() {
        const root = document.querySelector('[data-learner-gallery]');
        if (!root) return;
        root.replaceChildren();
        if (!galleryPhotos.length) {
            root.appendChild(element('p', 'col-12 text-muted', 'There are no published photographs in this gallery yet.'));
            updateSelectionCount();
            return;
        }
        galleryPhotos.forEach(function (photo) {
            const column = element('div', 'col-sm-6 col-lg-4');
            const card = element('article', 'gallery-photo-card h-100');
            const image = document.createElement('img');
            image.className = 'img-fluid';
            image.src = photo.url;
            image.alt = photo.title;
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
            const title = element('p', 'gallery-photo-card__meta mb-2', photo.title);
            const label = element('label', 'form-check d-flex align-items-center gap-2 px-3 pb-3');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'form-check-input m-0';
            checkbox.checked = selection.photoIds.has(photo.id);
            checkbox.setAttribute('aria-label', 'Select ' + photo.title + ' for an order request');
            checkbox.addEventListener('change', function () {
                if (checkbox.checked && !selection.photoIds.has(photo.id) && selection.photoIds.size >= 20) {
                    checkbox.checked = false;
                    showNotice(root.parentElement, 'A request can include up to 20 photographs.', 'alert-warning');
                    return;
                }
                if (checkbox.checked) selection.photoIds.add(photo.id);
                else selection.photoIds.delete(photo.id);
                saveSelection();
                renderCart();
            });
            label.append(checkbox, element('span', '', 'Select for order request'));
            const downloadStatus = element('p', 'gallery-photo-card__meta px-3 mb-2', '');
            const associatedOrder = downloadOrders.find(function (order) {
                return order.status !== 'cancelled' &&
                    (order.items || []).some(function (item) {
                        return item.item_type === 'photo' && item.photo_id === photo.id;
                    });
            });
            const request = associatedOrder && (associatedOrder.downloads || []).find(function (item) {
                return item.photo_id === photo.id;
            });
            const downloadButton = element(
                'button',
                'btn btn-sm btn-outline-primary mx-3 mb-3',
                request && request.status === 'approved' ? 'Download original' :
                    (request && request.status === 'pending' ? 'Download approval pending' :
                        (request && request.status === 'rejected' ? 'Request download again' : 'Request download'))
            );
            downloadButton.type = 'button';
            downloadButton.disabled = !associatedOrder ||
                Boolean(request && request.status === 'approved' && Number(request.download_count) >= 5) ||
                Boolean(request && request.status === 'pending');
            if (!associatedOrder) downloadStatus.textContent = 'Order this photograph before requesting its original.';
            else if (request && request.status === 'approved' && Number(request.download_count) >= 5) {
                downloadStatus.textContent = 'Download limit reached.';
                downloadButton.textContent = 'Download limit reached';
            } else if (request && request.status === 'pending') {
                downloadStatus.textContent = 'Waiting for MCM to review your download request.';
            }
            downloadButton.addEventListener('click', async function () {
                downloadButton.disabled = true;
                try {
                    if (request && request.status === 'approved') {
                        const result = await window.MCMBackend.parent.downloadPhoto(request.id);
                        window.location.assign(result.downloadUrl);
                        return;
                    }
                    const result = await window.MCMBackend.parent.requestPhotoDownload(associatedOrder.id, photo.id);
                    downloadOrders.forEach(function (order) {
                        if (order.id === associatedOrder.id) {
                            order.downloads = order.downloads || [];
                            order.downloads = order.downloads.filter(function (item) { return item.photo_id !== photo.id; });
                            order.downloads.push({
                                id: result.requestId,
                                order_id: order.id,
                                photo_id: photo.id,
                                status: result.status,
                                download_count: result.downloadCount
                            });
                        }
                    });
                    if (result.status === 'approved') {
                        renderGalleryCards();
                    } else {
                        downloadStatus.textContent = result.status === 'pending'
                            ? 'Download request sent. MCM must approve it before the original is available.'
                            : 'Download request status: ' + result.status + '.';
                        downloadButton.textContent = result.status === 'pending'
                            ? 'Download approval pending'
                            : 'Request download';
                        downloadButton.disabled = result.status === 'pending';
                    }
                } catch (error) {
                    showNotice(root.parentElement, error.message || 'The download request could not be completed.', 'alert-warning');
                    downloadButton.disabled = false;
                }
            });
            card.append(image, title, label, downloadStatus, downloadButton);
            column.appendChild(card);
            root.appendChild(column);
        });
        updateSelectionCount();
    }

    function switchGalleryTab(tabName) {
        document.querySelectorAll('[data-gallery-tab]').forEach(function (tab) {
            const active = tab.dataset.galleryTab === tabName;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-gallery-view]').forEach(function (view) {
            const active = view.dataset.galleryView === tabName;
            view.hidden = !active;
            view.style.display = active ? '' : 'none';
            view.classList.toggle('is-active', active);
        });
    }

    async function endParentSession(button) {
        button.disabled = true;
        try {
            await window.MCMBackend.parent.endSession();
            window.location.assign('school-access.html');
        } catch (error) {
            button.disabled = false;
            const notice = showNotice(
                document.querySelector('.school-page-hero .container'),
                error.message || 'Unable to end this session.',
                'alert-danger'
            );
            appendAccessLink(notice);
        }
    }

    function connectGallery() {
        const galleryRoot = document.querySelector('[data-learner-gallery]');
        const hero = document.querySelector('.school-page-hero .container');
        const actions = document.querySelector('.gallery-hero-panel__actions');
        if (!galleryRoot) return;

        if (actions) {
            actions.replaceChildren();
            const orderStatus = element('a', 'btn btn-primary', 'Order status');
            orderStatus.href = 'school-order-tracking.html';
            const signOut = element('button', 'btn btn-outline-primary', 'Sign out');
            signOut.type = 'button';
            signOut.addEventListener('click', function () {
                endParentSession(signOut);
            });
            actions.append(orderStatus, signOut);
        }
        document.querySelectorAll('[data-gallery-tab]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                switchGalleryTab(tab.dataset.galleryTab);
            });
        });
        const requestedTab = new URLSearchParams(window.location.search).get('tab');
        switchGalleryTab(['gallery', 'store', 'cart'].includes(requestedTab) ? requestedTab : 'gallery');
        setLearnerSummary({ name: 'Loading gallery…', school: 'Loading…', className: 'Loading…' });
        showNotice(hero, 'Submit an unpaid order request for selected photos or packages. No online payment is taken.', 'alert-info');
        showNotice(galleryRoot.parentElement, 'Loading your private gallery…', 'alert-info');

        Promise.all([
            window.MCMBackend.parent.gallery(),
            window.MCMBackend.getActivePackages(),
            window.MCMBackend.parent.orders()
        ]).then(function (results) {
            const gallery = results[0];
            galleryPhotos = gallery.photos || [];
            activePackages = results[1] || [];
            downloadOrders = results[2].orders || [];
            setLearnerSummary(gallery.learner);
            selection.photoIds.forEach(function (id) {
                if (!galleryPhotos.some(function (photo) { return photo.id === id; })) selection.photoIds.delete(id);
            });
            selection.packageIds.forEach(function (id) {
                if (!activePackages.some(function (item) { return item.id === id; })) selection.packageIds.delete(id);
            });
            saveSelection();
            renderGalleryCards();
            renderPackageCards(document.querySelector('[data-store-packages]'), activePackages, false);
            renderCart();
            showNotice(
                galleryRoot.parentElement,
                galleryPhotos.length
                    ? 'Your private gallery is ready. Image links expire automatically for your protection.'
                    : 'There are no published photographs in this gallery yet.',
                'alert-info'
            );
        }).catch(function (error) {
            window.MCMBackend.parent.clearAccess();
            galleryRoot.replaceChildren();
            setLearnerSummary({ name: 'Access required', school: 'Not loaded', className: 'Not loaded' });
            const notice = showNotice(
                galleryRoot.parentElement,
                error.message || 'Unable to load your gallery.',
                'alert-danger'
            );
            appendAccessLink(notice);
        });
    }

    function renderCheckoutItems(photos, packages) {
        const target = document.querySelector('[data-checkout-items]');
        if (!target) return;
        target.replaceChildren();
        const chosenPhotos = photos.filter(function (photo) { return selection.photoIds.has(photo.id); });
        const chosenPackages = packages.filter(function (item) { return selection.packageIds.has(item.id); });
        const items = chosenPhotos.map(function (item) {
            return item.title + ' — photograph';
        }).concat(chosenPackages.map(function (item) {
            return item.name + ' — ' + money(item.price_cents);
        }));
        if (!items.length) {
            target.appendChild(element('p', 'text-danger', 'No items are selected. Return to the gallery and select a photo or package.'));
            return false;
        }
        const list = element('ul', 'list-group mb-3');
        items.forEach(function (item) {
            list.appendChild(element('li', 'list-group-item', item));
        });
        target.append(element('h2', 'h5', 'Selected items'), list);
        return true;
    }

    function connectCheckout(form) {
        const status = form.querySelector('[data-order-submit-status]');
        const submit = form.querySelector('button[type="submit"]');
        setFormDisabled(form, false);
        submit.disabled = true;
        Promise.all([window.MCMBackend.parent.gallery(), window.MCMBackend.getActivePackages()]).then(function (results) {
            const photos = results[0].photos || [];
            const packages = results[1] || [];
            galleryPhotos = photos;
            activePackages = packages;
            selection.photoIds.forEach(function (id) {
                if (!photos.some(function (photo) { return photo.id === id; })) selection.photoIds.delete(id);
            });
            selection.packageIds.forEach(function (id) {
                if (!packages.some(function (item) { return item.id === id; })) selection.packageIds.delete(id);
            });
            saveSelection();
            if (renderCheckoutItems(photos, packages)) {
                submit.disabled = false;
            }
            renderCart();
        }).catch(function (error) {
            if (status) {
                status.textContent = error.message || 'Your parent session is unavailable. Sign in again to continue.';
                status.classList.add('text-danger');
            }
            appendAccessLink(showNotice(form, 'Parent access is required to submit an order request.', 'alert-danger'));
        });

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (submit.disabled || !form.reportValidity()) return;
            submit.disabled = true;
            if (status) {
                status.textContent = 'Submitting your unpaid order request…';
                status.classList.remove('text-danger', 'text-success');
            }
            try {
                const result = await window.MCMBackend.parent.submitOrder({
                    photoIds: Array.from(selection.photoIds),
                    packageIds: Array.from(selection.packageIds),
                    parentNote: String(form.elements.parentNote.value || '').trim()
                });
                selection.photoIds.clear();
                selection.packageIds.clear();
                saveSelection();
                form.reset();
                renderCart();
                if (status) {
                    status.textContent = 'Request received. Your order reference is ' + result.orderCode +
                        '. No payment has been taken. Track updates from the parent gallery.';
                    status.classList.add('text-success');
                }
                const target = document.querySelector('[data-checkout-items]');
                if (target) target.replaceChildren();
            } catch (error) {
                if (status) {
                    status.textContent = error.message || 'The order request could not be submitted. Please try again.';
                    status.classList.add('text-danger');
                }
                submit.disabled = false;
            }
        });
    }

    function connectOrderTracking() {
        const target = document.querySelector('[data-order-status]');
        if (!target) return;
        target.textContent = 'Loading your order requests…';
        window.MCMBackend.parent.orders().then(function (result) {
            target.replaceChildren();
            const orders = result.orders || [];
            if (!orders.length) {
                target.appendChild(element('p', 'text-muted', 'No order requests have been submitted for this gallery.'));
                return;
            }
            orders.forEach(function (order) {
                const card = element('article', 'teacher-card mb-3');
                card.append(
                    element('h2', 'h5', 'Order ' + order.order_code),
                    element('p', '', 'Status: ' + order.status.replace(/_/g, ' ')),
                    element('p', '', 'Production: ' + order.production_status.replace(/_/g, ' ')),
                    element('p', '', 'Delivery: ' + order.delivery_status.replace(/_/g, ' '))
                );
                const list = element('ul', 'mb-0');
                (order.items || []).forEach(function (item) {
                    list.appendChild(element('li', '', item.title_snapshot));
                });
                card.appendChild(list);
                target.appendChild(card);
            });
        }).catch(function (error) {
            target.replaceChildren(element('p', 'text-danger', error.message || 'Unable to load your order requests.'));
            const link = element('a', 'btn btn-outline-primary mt-2', 'Sign in to parent gallery');
            link.href = 'school-access.html';
            target.appendChild(link);
        });
    }

    function connectMarketingPackages() {
        const container = document.querySelector('[data-package-list]');
        if (!container || !window.MCMBackend || !window.MCMBackend.isReady()) return;
        window.MCMBackend.getActivePackages().then(function (packages) {
            renderPackageCards(container, packages, true);
        }).catch(function (error) {
            showNotice(container.parentElement, error.message || 'Unable to load photography packages.', 'alert-danger');
        });
    }

    function initializePortal() {
        const accessForm = document.querySelector('#parentAccessForm');
        const galleryRoot = document.querySelector('[data-learner-gallery]');
        const checkoutForm = document.querySelector('#checkoutForm');
        const orderStatus = document.querySelector('[data-order-status]');
        if (!accessForm && !galleryRoot && !checkoutForm && !orderStatus) return;

        const configured = window.MCMBackend && window.MCMBackend.isReady();
        const accessPage = document.querySelector('.teacher-card, .school-page-hero .container');
        const configurationMessage = window.MCMBackend
            ? window.MCMBackend.readinessMessage()
            : 'The Supabase client library did not load.';

        if (accessForm) {
            if (!configured) {
                setFormDisabled(accessForm, true);
                showNotice(accessPage, 'Secure parent access is unavailable until the backend is deployed. ' +
                    configurationMessage + ' No learner PINs are stored or checked in the browser.');
            } else {
                showNotice(accessPage, 'Enter the learner reference code and 6–12 digit PIN supplied by the school.', 'alert-info');
                connectAccessForm(accessForm);
            }
        }
        if (galleryRoot) {
            if (!configured) {
                showNotice(accessPage, 'This private gallery is locked. ' + configurationMessage +
                    ' No learner or photograph data is loaded.');
                document.querySelectorAll('.gallery-tabs, [data-gallery-view], .gallery-hero-panel__actions').forEach(function (node) {
                    node.hidden = true;
                    node.style.display = 'none';
                });
            } else {
                connectGallery();
            }
        }
        if (checkoutForm) {
            if (!configured) {
                setFormDisabled(checkoutForm, true);
                showNotice(accessPage, configurationMessage || 'Order requests are unavailable.', 'alert-danger');
            } else {
                connectCheckout(checkoutForm);
            }
        }
        if (orderStatus) {
            if (!configured) {
                showNotice(accessPage, configurationMessage || 'Order tracking is unavailable.', 'alert-danger');
            } else {
                connectOrderTracking();
            }
        }
    }

    connectMarketingPackages();
    initializePortal();
}());
