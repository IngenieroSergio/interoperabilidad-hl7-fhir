// C:\Users\Dell\Documents\Cecar2025\prueba2claude\js\main.js
        // Carousel functionality
        document.addEventListener('DOMContentLoaded', function() {
            const carouselContainer = document.querySelector('.carousel-container');
            const slides = document.querySelectorAll('.carousel-slide');
            const dots = document.querySelectorAll('.carousel-dot');
            let currentIndex = 0;
            
            function updateCarousel() {
                carouselContainer.style.transform = `translateX(-${currentIndex * 100}%)`;
                dots.forEach((dot, index) => {
                    dot.classList.toggle('active', index === currentIndex);
                });
            }
            
            // Handle dot clicks
            dots.forEach((dot, index) => {
                dot.addEventListener('click', () => {
                    currentIndex = index;
                    updateCarousel();
                });
            });
            
            // Auto slide
            setInterval(() => {
                currentIndex = (currentIndex + 1) % slides.length;
                updateCarousel();
            }, 5000);
        });
        
        // Auth buttons
        const loginBtn = document.querySelector('.btn-outline');
        const registerBtn = document.querySelector('.btn-primary');
        
        loginBtn.addEventListener('click', function() {
            window.location.href = 'auth/login.html'; // Redirige a login
        });
        
        registerBtn.addEventListener('click', function() {
            window.location.href = 'auth/register.html'; // Redirige a registro
        });