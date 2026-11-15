(function () {
    'use strict';

    const packages = [
        {
            name: 'Package 1',
            price: 'R250',
            description: 'A keepsake-ready bundle featuring framed, laminated and personalised items.'
        },
        {
            name: 'Package 2',
            price: 'R300',
            description: 'A larger premium bundle with a statement print and classic keepsakes.'
        }
    ];

    function renderMarketingPackages() {
        const container = document.querySelector('[data-package-list]');
        if (!container) {
            return;
        }

        container.replaceChildren();
        packages.forEach(function (item) {
            const card = document.createElement('article');
            card.className = 'package-card package-card--compact';

            const name = document.createElement('h3');
            name.textContent = item.name;
            const price = document.createElement('p');
            price.className = 'package-price';
            price.textContent = item.price;
            const description = document.createElement('p');
            description.textContent = item.description;

            card.append(name, price, description);
            container.appendChild(card);
        });
    }

    function showNotice(target, message, tone) {
        if (!target) {
            return null;
        }
        let notice = target.querySelector('[data-backend-status]');
        if (!notice) {
            notice = document.createElement('div');
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
        if (!form) {
            return;
        }
        form.querySelectorAll('input, select, textarea, button').forEach(function (control) {
            control.disabled = disabled;
        });
    }

    function connectAccessForm(form) {
        setFormDisabled(form, false);
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (!form.reportValidity()) {
                return;
            }

            const reference = form.elements.learnerRef.value.trim();
            const pin = form.elements.pin.value;
            const submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            setFormStatus(form, 'Verifying secure access…', false);
            try {
                await window.MCMBackend.parent.access(reference, pin);
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

    function renderGallery(photos) {
        const root = document.querySelector('[data-learner-gallery]');
        if (!root) {
            return;
        }
        root.replaceChildren();
        if (!photos.length) {
            const empty = document.createElement('p');
            empty.className = 'col-12 text-muted';
            empty.textContent = 'There are no published photographs in this gallery yet.';
            root.appendChild(empty);
            return;
        }

        photos.forEach(function (photo) {
            const column = document.createElement('div');
            column.className = 'col-sm-6 col-lg-4';
            const card = document.createElement('article');
            card.className = 'gallery-photo-card h-100';
            const image = document.createElement('img');
            image.className = 'img-fluid';
            image.src = photo.url;
            image.alt = photo.title;
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
            const title = document.createElement('p');
            title.className = 'gallery-photo-card__meta mb-0';
            title.textContent = photo.title;
            card.append(image, title);
            column.appendChild(card);
            root.appendChild(column);
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
        const tabs = document.querySelector('.gallery-tabs');
        const actions = document.querySelector('.gallery-hero-panel__actions');
        const galleryView = document.querySelector('[data-gallery-view="gallery"]');
        if (!galleryRoot) {
            return;
        }

        if (tabs) tabs.hidden = true;
        document.querySelectorAll('[data-gallery-view]').forEach(function (view) {
            const isGallery = view === galleryView;
            view.hidden = !isGallery;
            view.style.display = isGallery ? '' : 'none';
        });
        const toolbar = document.querySelector('.gallery-toolbar');
        if (toolbar) toolbar.hidden = true;

        if (actions) {
            actions.replaceChildren();
            actions.hidden = false;
            actions.style.display = 'flex';
            const signOut = document.createElement('button');
            signOut.type = 'button';
            signOut.className = 'btn btn-outline-primary';
            signOut.textContent = 'Sign out';
            signOut.addEventListener('click', function () {
                endParentSession(signOut);
            });
            actions.appendChild(signOut);
        }

        setLearnerSummary({
            name: 'Loading gallery…',
            school: 'Loading…',
            className: 'Loading…'
        });
        showNotice(hero, 'Online ordering and payments are not enabled. This gallery is read-only.', 'alert-info');
        showNotice(galleryRoot.parentElement, 'Loading your private gallery…', 'alert-info');
        window.MCMBackend.parent.gallery().then(function (result) {
            setLearnerSummary(result.learner);
            renderGallery(result.photos);
            showNotice(
                galleryRoot.parentElement,
                result.photos.length
                    ? 'Your private gallery is ready. Image links expire automatically for your protection.'
                    : 'There are no published photographs in this gallery yet.',
                'alert-info'
            );
        }).catch(function (error) {
            window.MCMBackend.parent.clearAccess();
            galleryRoot.replaceChildren();
            setLearnerSummary({
                name: 'Access required',
                school: 'Not loaded',
                className: 'Not loaded'
            });
            const notice = showNotice(
                galleryRoot.parentElement,
                error.message || 'Unable to load your gallery.',
                'alert-danger'
            );
            appendAccessLink(notice);
        });
    }

    function disableOrders(form, title) {
        setFormDisabled(form, true);
        const card = form.closest('.teacher-card');
        showNotice(
            card,
            'Online ordering, payments and order tracking are not enabled. Please contact MCM Photography for assistance.',
            'alert-info'
        );
        if (title) {
            title.textContent = 'Online ordering is not available yet';
        }
    }

    function initializePortal() {
        const accessForm = document.querySelector('#parentAccessForm');
        const galleryRoot = document.querySelector('[data-learner-gallery]');
        const checkoutForm = document.querySelector('#checkoutForm');
        const trackingForm = document.querySelector('#orderTrackingForm');
        if (!accessForm && !galleryRoot && !checkoutForm && !trackingForm) {
            return;
        }

        const configured = window.MCMBackend && window.MCMBackend.isReady();
        const accessPage = document.querySelector('.teacher-card, .school-page-hero .container');
        const configurationMessage = window.MCMBackend
            ? window.MCMBackend.readinessMessage()
            : 'The Supabase client library did not load.';

        if (accessForm) {
            const submit = accessForm.querySelector('button[type="submit"]');
            if (!configured) {
                setFormDisabled(accessForm, true);
                showNotice(
                    accessPage,
                    'Secure parent access is unavailable until the backend is deployed. ' +
                        configurationMessage + ' No learner PINs are stored or checked in the browser.'
                );
            } else {
                showNotice(accessPage, 'Enter the learner reference code and 6–12 digit PIN supplied by the school.', 'alert-info');
                connectAccessForm(accessForm);
            }
            if (submit) submit.disabled = !configured;
        }

        if (galleryRoot) {
            if (!configured) {
                showNotice(
                    accessPage,
                    'This private gallery is locked. ' + configurationMessage +
                        ' No learner or photograph data is loaded.'
                );
                document.querySelectorAll('.gallery-tabs, [data-gallery-view], .gallery-hero-panel__actions').forEach(function (element) {
                    element.hidden = true;
                    element.style.display = 'none';
                });
            } else {
                connectGallery();
            }
        }

        if (checkoutForm) {
            disableOrders(checkoutForm);
        }
        if (trackingForm) {
            disableOrders(trackingForm);
        }
    }

    renderMarketingPackages();
    initializePortal();
}());
