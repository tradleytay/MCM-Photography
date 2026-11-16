(function($) {
    "use strict";
    var spinner = document.getElementById('spinner');
    if (spinner) {
        var spinnerStartedAt = Date.now();
        var hideScheduled = false;
        var hideSpinner = function() {
            if (hideScheduled) {
                return;
            }
            hideScheduled = true;
            var minimumVisibleTime = 350;
            var wait = Math.max(0, minimumVisibleTime - (Date.now() - spinnerStartedAt));
            window.setTimeout(function() {
                spinner.classList.remove('show');
            }, wait);
        };

        if (document.readyState === 'complete') {
            hideSpinner();
        } else {
            window.addEventListener('load', hideSpinner, { once: true });
        }
        window.setTimeout(hideSpinner, 5000);
    }
    if (!$) {
        return;
    }

    // Initiate the wowjs
    new WOW().init();
    // Keep navigation available, with a subtle scrolled state.
    var updateNavbar = function() {
        $('.navbar').toggleClass('navbar-scrolled', $(window).scrollTop() > 24);
    };
    $(window).on('scroll', updateNavbar);
    updateNavbar();

    $('.gallery-filter').on('click', function() {
        var filter = $(this).data('filter');
        $('.gallery-filter').removeClass('is-active');
        $(this).addClass('is-active');
        $('.gallery-item').each(function() {
            var match = filter === 'all' || $(this).data('category') === filter;
            $(this).toggleClass('is-hidden', !match);
        });
    });

    $('.gallery-item').on('click', function() {
        var image = $(this).data('image');
        var title = $(this).data('title');
        $('#galleryLightboxImage').attr('src', image);
        $('#galleryLightboxTitle').text(title);
        var modal = new bootstrap.Modal(document.getElementById('galleryLightbox'));
        modal.show();
    });
    // Modal Video
    var $videoSrc;
    $('.btn-play').click(function() {
        $videoSrc = $(this).data("src");
    });
    $('#videoModal').on('shown.bs.modal', function() {
        $("#video").attr('src', $videoSrc + "?autoplay=1&modestbranding=1&showinfo=0");
    });
    $('#videoModal').on('hide.bs.modal', function() {
        $("#video").attr('src', "");
    });
    // Back to top button
    $(window).scroll(function() {
        if ($(this).scrollTop() > 300) {
            $('.back-to-top').fadeIn('slow');
        } else {
            $('.back-to-top').fadeOut('slow');
        }
    });
    $('.back-to-top').click(function() {
        $('html, body').animate({ scrollTop: 0 }, 1500, 'easeInOutExpo');
        return false;
    });
    // Facts counter
    if ($.fn.counterUp && $('[data-toggle="counter-up"]').length) {
        $('[data-toggle="counter-up"]').counterUp({
            delay: 10,
            time: 2000
        });
    }
    // Testimonials carousel
    if ($.fn.owlCarousel && $(".testimonial-carousel").length) {
        $(".testimonial-carousel").owlCarousel({
        autoplay: false,
        smartSpeed: 1000,
        margin: 25,
        loop: true,
        center: true,
        dots: false,
        nav: true,
        navText: [
            '<i class="bi bi-chevron-left"></i>',
            '<i class="bi bi-chevron-right"></i>'
        ],
        responsive: {
            0: {
                items: 1
            },
            768: {
                items: 2
            },
            992: {
                items: 3
            }
        }
        });
    }
})(window.jQuery);
/* WhatsApp booking links */
(function() {
    var whatsappPhone = "27825344850";
    var defaultMessage = "Hello MCM Photography, I'd like to book a session. My preferred date is: ";
    document.querySelectorAll('.whatsapp-float').forEach(function(link) {
        var extra = link.getAttribute('data-text') || '';
        var message = encodeURIComponent(extra || defaultMessage);
        link.href = 'https://wa.me/' + whatsappPhone + '?text=' + message;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    });
    document.querySelectorAll('.whatsapp-book').forEach(function(link) {
        var packageName = link.getAttribute('data-package') || '';
        var message = defaultMessage + '\nPackage: ' + packageName + '\nPreferred date: ';
        link.href = 'https://wa.me/' + whatsappPhone + '?text=' + encodeURIComponent(message);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    });
    var contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!contactForm.reportValidity()) return;
            var status = contactForm.querySelector('[data-booking-status]');
            var submit = contactForm.querySelector('button[type="submit"]');
            var formData = new FormData(contactForm);
            if (!window.MCMBackend || !window.MCMBackend.isReady()) {
                if (status) {
                    status.textContent = window.MCMBackend
                        ? window.MCMBackend.readinessMessage() + ' Please contact us by phone or WhatsApp instead.'
                        : 'Booking requests are temporarily unavailable. Please contact us by phone or WhatsApp instead.';
                    status.classList.add('text-danger');
                }
                return;
            }
            submit.disabled = true;
            if (status) {
                status.textContent = 'Sending your booking request…';
                status.classList.remove('text-danger', 'text-success');
            }
            try {
                var result = await window.MCMBackend.submitBooking({
                    name: String(formData.get('name') || '').trim(),
                    email: String(formData.get('email') || '').trim(),
                    phone: String(formData.get('phone') || '').trim(),
                    serviceType: String(formData.get('serviceType') || '').trim(),
                    preferredDate: String(formData.get('preferredDate') || ''),
                    message: String(formData.get('message') || '').trim()
                });
                contactForm.reset();
                if (status) {
                    status.textContent = 'Request received. Your reference is ' + result.bookingCode +
                        '. We will contact you to confirm details.';
                    status.classList.add('text-success');
                    status.classList.remove('text-danger');
                }
            } catch (error) {
                if (status) {
                    status.textContent = error.message || 'The booking request could not be sent. Please try again or contact us directly.';
                    status.classList.add('text-danger');
                    status.classList.remove('text-success');
                }
            } finally {
                submit.disabled = false;
            }
        });
    }
})();

(function() {
    var mainScript = document.currentScript;
    if (!mainScript || !mainScript.src) return;
    var contentScript = document.createElement('script');
    contentScript.src = new URL('site-content.js', mainScript.src).href;
    contentScript.defer = true;
    document.head.appendChild(contentScript);
})();
