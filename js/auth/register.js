// js/auth/register.js
document.addEventListener('DOMContentLoaded', function() {
    const registerForm = document.getElementById('register-form');
    const passwordInput = document.getElementById('reg-password');
    const confirmPasswordInput = document.getElementById('reg-confirm-password');
    const strengthIndicator = document.querySelector('.strength-indicator');
    const strengthText = document.querySelector('.strength-text');
    const errorMessage = document.getElementById('register-error');
    
    // Función para evaluar fortaleza de contraseña
    function evaluatePasswordStrength(password) {
        let score = 0;
        if (!password) return { score: 0, feedback: '' };

        // Longitud
        if (password.length > 8) score++;
        if (password.length > 12) score++;
        
        // Complejidad
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;
        
        let feedback = '';
        if (score < 3) feedback = 'Débil';
        else if (score < 5) feedback = 'Moderada';
        else feedback = 'Fuerte';
        
        return { score, feedback };
    }
    
    // Actualizar indicador de fortaleza
    function updatePasswordStrength() {
        const password = passwordInput.value;
        const { score, feedback } = evaluatePasswordStrength(password);
        
        strengthIndicator.style.width = `${(score / 5) * 100}%`;
        strengthText.textContent = `Fortaleza: ${feedback}`;
        
        // Colores según fortaleza
        if (score < 3) {
            strengthIndicator.style.backgroundColor = '#e74c3c';
        } else if (score < 5) {
            strengthIndicator.style.backgroundColor = '#f39c12';
        } else {
            strengthIndicator.style.backgroundColor = '#2ecc71';
        }
    }
    
    // Evento para actualizar fortaleza de contraseña
    if (passwordInput) {
        passwordInput.addEventListener('input', updatePasswordStrength);
    }
    
    // Manejar visibilidad de contraseñas
    const togglePasswordButtons = document.querySelectorAll('.toggle-password');
    togglePasswordButtons.forEach(button => {
        button.addEventListener('click', function() {
            const input = this.previousElementSibling;
            const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
            input.setAttribute('type', type);
            
            // Cambiar icono
            this.innerHTML = type === 'password' ? 
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' :
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        });
    });
    
    // Validar formulario de registro para FHIR
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Obtener valores del formulario
            const name = document.getElementById('reg-name').value.trim();
            const license = document.getElementById('reg-license').value.trim();
            const specialty = document.getElementById('reg-specialty').value;
            const email = document.getElementById('reg-email').value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            const terms = document.getElementById('terms').checked;
            
            // Validaciones básicas
            if (!name || !license || !specialty || !email || !password || !confirmPassword) {
                showError('Por favor, complete todos los campos');
                return;
            }
            
            // Validar formato de email
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showError('Por favor, ingrese un correo electrónico válido');
                return;
            }
            
            // Validar que las contraseñas coincidan
            if (password !== confirmPassword) {
                showError('Las contraseñas no coinciden');
                return;
            }
            
            // Validar fortaleza de contraseña
            const { score } = evaluatePasswordStrength(password);
            if (score < 3) {
                showError('La contraseña es demasiado débil. Debe incluir letras mayúsculas, minúsculas, números y tener al menos 8 caracteres.');
                return;
            }
            
            if (!terms) {
                showError('Debe aceptar los términos del servicio');
                return;
            }
            
            try {
                // Crear recurso Practitioner para FHIR
                const practitionerData = {
                    resourceType: "Practitioner",
                    active: true,
                    name: [{
                        use: "official",
                        text: name,
                        family: name.split(' ')[0] || '',
                        given: name.split(' ').slice(1) || []
                    }],
                    identifier: [{
                        system: "http://example.org/medical-license",
                        value: license
                    }],
                    telecom: [{
                        system: "email",
                        value: email,
                        use: "work"
                    }],
                    qualification: [{
                        code: {
                            coding: [{
                                system: "http://snomed.info/sct",
                                code: getSnomedCodeForSpecialty(specialty),
                                display: document.getElementById('reg-specialty').options[document.getElementById('reg-specialty').selectedIndex].text
                            }]
                        },
                        identifier: [{
                            system: "http://example.org/medical-license",
                            value: license
                        }]
                    }]
                };
                
                // Enviar al servidor HAPI FHIR local
                const fhirServerUrl = 'http://localhost:8080/fhir/Practitioner';
                const response = await fetch(fhirServerUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/fhir+json',
                        'Accept': 'application/fhir+json'
                    },
                    body: JSON.stringify(practitionerData)
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.issue?.[0]?.details?.text || 'Error al registrar el médico en el servidor FHIR');
                }
                
                const practitioner = await response.json();
                
                // Mostrar mensaje de éxito con ID de recurso FHIR
                registerForm.innerHTML = `
                    <div class="success-message">
                        <div class="success-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#27AE60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        </div>
                        <h3>¡Médico registrado con éxito!</h3>
                        <p>Su perfil ha sido creado en el sistema FHIR con ID: <strong>${practitioner.id}</strong></p>
                        <p>Ahora puede iniciar sesión con su correo y contraseña.</p>
                        <div class="form-group">
                            <button type="button" class="btn btn-primary btn-block" onclick="window.location.href='login.html'">Continuar al Login</button>
                        </div>
                    </div>
                `;
                
                const users = JSON.parse(localStorage.getItem('mediconnect_users') || '[]');
                users.push({
                    email: email,
                    password: password, // En producción NUNCA hagas esto
                    practitionerId: practitioner.id
                });
                localStorage.setItem('mediconnect_users', JSON.stringify(users));
                
            } catch (error) {
                console.error('Error en el registro FHIR:', error);
                showError(`Error al registrar: ${error.message}`);
            }
        });
    }
    
    // Mapeo de especialidades a códigos SNOMED CT
    function getSnomedCodeForSpecialty(specialty) {
        const specialties = {
            'general': '419772000',    // Medicina general
            'cardiology': '394579002', // Cardiología
            'neurology': '394591006',  // Neurología
            'pediatrics': '394537008',  // Pediatría
            'dermatology': '394576009'  // Dermatología
        };
        return specialties[specialty] || '419772000'; // Default: Medicina general
    }
    
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('visible');
        
        setTimeout(() => {
            errorMessage.classList.remove('visible');
        }, 5000);
    }

    
});