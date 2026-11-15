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
        contactForm.addEventListener('submit', function(event) {
            event.preventDefault();
            var formData = new FormData(contactForm);
            var message = [
                'Hello MCM Photography, I would like to enquire about a session.',
                '',
                'Name: ' + formData.get('name'),
                'Email: ' + formData.get('email'),
                'Subject: ' + formData.get('subject'),
                '',
                formData.get('message')
            ].join('\n');
            if (event.submitter && event.submitter.value === 'email') {
                window.location.href = 'mailto:mcmphotographyct@gmail.com?subject=' +
                    encodeURIComponent(formData.get('subject')) + '&body=' + encodeURIComponent(message);
                return;
            }
            window.location.href = 'https://wa.me/' + whatsappPhone + '?text=' + encodeURIComponent(message);
        });
    }
})();
