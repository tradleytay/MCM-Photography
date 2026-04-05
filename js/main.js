(function($) {
    "use strict";

    // Spinner
    var spinner = function() {
        setTimeout(function() {
            if ($('#spinner').length > 0) {
                $('#spinner').removeClass('show');
            }
        }, 1);
    };
    spinner();


    // Initiate the wowjs
    new WOW().init();


    // Navbar on scrolling
    $(window).scroll(function() {
        if ($(this).scrollTop() > 300) {
            $('.navbar').fadeIn('slow').css('display', 'flex');
        } else {
            $('.navbar').fadeOut('slow').css('display', 'none');
        }
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
    $('[data-toggle="counter-up"]').counterUp({
        delay: 10,
        time: 2000
    });


    // Testimonials carousel
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


})(jQuery);

/* WhatsApp Booking Button
   This code builds the wa.me link for elements with class `whatsapp-float`.
   Replace `whatsappPhone` with your business number in E.164 format WITHOUT the leading + (e.g. 15551234567).
*/
(function() {
    try {
        var whatsappPhone = "260760678894"; // TODO: replace with your number, no + or dashes
        var defaultMessage = "Hello MCM Photography, I'd like to book a session. My preferred date is: ";
        var els = document.querySelectorAll('.whatsapp-float');
        if (!whatsappPhone) return;

        // helper: small confirmation toast
        function showConfirmation(text) {
            var id = 'wa-confirm-toast';
            var el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.className = 'whatsapp-confirm';
                document.body.appendChild(el);
            }
            el.textContent = text;
            el.classList.add('show');
            if (el._timeout) clearTimeout(el._timeout);
            el._timeout = setTimeout(function() {
                el.classList.remove('show');
            }, 2200);
        }

        // Configure floating whatsapp anchors if present
        if (els && els.length) {
            els.forEach(function(el) {
                var extra = el.getAttribute('data-text') || '';
                var msg = encodeURIComponent(defaultMessage + extra);
                var url = 'https://wa.me/' + whatsappPhone + '?text=' + msg;
                el.setAttribute('href', url);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');

                // show confirmation then open (so user sees feedback)
                el.addEventListener('click', function(ev) {
                    // allow ctrl/cmd+click to open in new tab normally
                    if (ev.metaKey || ev.ctrlKey) return;
                    ev.preventDefault();
                    showConfirmation('Opening WhatsApp...');
                    setTimeout(function() {
                        window.open(url, '_blank', 'noopener');
                    }, 350);
                });
            });
        }

        // Wire package-level booking buttons (elements with class `whatsapp-book`)
        var bookButtons = document.querySelectorAll('.whatsapp-book');
        if (bookButtons && bookButtons.length) {
            bookButtons.forEach(function(btn) {
                btn.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    var pkg = btn.getAttribute('data-package') || '';
                    var msg = defaultMessage + '\nPackage: ' + pkg + '\nPreferred date: ';
                    var url = 'https://wa.me/' + whatsappPhone + '?text=' + encodeURIComponent(msg);
                    showConfirmation('Opening WhatsApp — ' + pkg);
                    setTimeout(function() {
                        window.open(url, '_blank', 'noopener');
                    }, 350);
                });
            });
        }
    } catch (e) {
        console && console.error && console.error('WhatsApp button setup error', e);
    }
})();