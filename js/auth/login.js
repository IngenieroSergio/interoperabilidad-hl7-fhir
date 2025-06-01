// js/auth/login.js
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('login-error');
    
    // Configuración
    const FIREBASE_URL = 'https://hapi-fhir-16ed2-default-rtdb.firebaseio.com';
    // const FHIR_SERVER = 'http://localhost:8080/fhir';
    const STORAGE_KEY = 'mediconnect_users';
    
    // Manejar visibilidad de contraseña
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', function() {
            const input = this.previousElementSibling;
            input.type = input.type === 'password' ? 'text' : 'password';
            this.innerHTML = input.type === 'password' ? 
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' :
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        });
    });
    
    // Función para verificar contraseña encriptada
    async function verifyPassword(inputPassword, storedHash, storedSalt) {
        try {
            // Combinar contraseña con el salt almacenado
            const encoder = new TextEncoder();
            const data = encoder.encode(inputPassword + storedSalt);
            
            // Generar hash SHA-256
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            return hash === storedHash;
        } catch (error) {
            console.error('Error al verificar contraseña:', error);
            return false;
        }
    }
    
    // Función para buscar médico por email en Firebase
    async function getPractitionerByEmail(email) {
        try {
            const emailKey = email.replace(/[.#$[\]]/g, '_');
            const response = await fetch(`${FIREBASE_URL}/email_index/${emailKey}.json`);
            
            if (!response.ok) {
                throw new Error('Email no encontrado');
            }
            
            const emailData = await response.json();
            if (!emailData || !emailData.practitionerId) {
                throw new Error('Email no encontrado en el sistema');
            }
            
            // Obtener los datos completos del médico
            const practitionerResponse = await fetch(`${FIREBASE_URL}/practitioners/${emailData.practitionerId}.json`);
            
            if (!practitionerResponse.ok) {
                throw new Error('Error al obtener datos del médico');
            }
            
            const practitionerData = await practitionerResponse.json();
            if (!practitionerData) {
                throw new Error('Datos del médico no encontrados');
            }
            
            return practitionerData;
        } catch (error) {
            console.error('Error al buscar médico por email:', error);
            throw error;
        }
    }
    
    // Función para actualizar último login
    async function updateLastLogin(practitionerId) {
        try {
            const updateData = {
                lastLogin: new Date().toISOString(),
                loginAttempts: 0,
                lockedUntil: null
            };
            
            await fetch(`${FIREBASE_URL}/practitioners/${practitionerId}/auth.json`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });
        } catch (error) {
            console.error('Error al actualizar último login:', error);
            // No lanzar error aquí, es opcional
        }
    }
    
    // Función para incrementar intentos fallidos
    async function incrementFailedAttempts(practitionerId, currentAttempts = 0) {
        try {
            const newAttempts = currentAttempts + 1;
            const updateData = {
                loginAttempts: newAttempts
            };
            
            // Bloquear cuenta si hay muchos intentos fallidos
            if (newAttempts >= 5) {
                updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutos
            }
            
            await fetch(`${FIREBASE_URL}/practitioners/${practitionerId}/auth.json`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });
            
            return newAttempts;
        } catch (error) {
            console.error('Error al actualizar intentos fallidos:', error);
            return currentAttempts;
        }
    }
    
    // Función para verificar si la cuenta está bloqueada
    function isAccountLocked(authData) {
        if (!authData.lockedUntil) return false;
        
        const lockTime = new Date(authData.lockedUntil);
        const now = new Date();
        
        return now < lockTime;
    }
    
    // Autenticación principal
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Mostrar indicador de carga
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        submitButton.textContent = 'Iniciando sesión...';
        submitButton.disabled = true;
        
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        
        try {
            // Validaciones básicas
            if (!email || !password) {
                throw new Error('Por favor complete todos los campos');
            }
            
            // Validar formato de email
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error('Por favor ingrese un correo electrónico válido');
            }
            
            // 1. Buscar médico en Firebase
            const practitionerData = await getPractitionerByEmail(email);
            
            // 2. Verificar si la cuenta está activa
            if (!practitionerData.auth.isActive) {
                throw new Error('Su cuenta ha sido desactivada. Contacte al administrador.');
            }
            
            // 3. Verificar si la cuenta está bloqueada
            if (isAccountLocked(practitionerData.auth)) {
                const unlockTime = new Date(practitionerData.auth.lockedUntil).toLocaleTimeString();
                throw new Error(`Cuenta bloqueada por múltiples intentos fallidos. Inténtelo después de las ${unlockTime}`);
            }
            
            // 4. Verificar credenciales
            const isValidPassword = await verifyPassword(
                password, 
                practitionerData.auth.passwordHash, 
                practitionerData.auth.passwordSalt
            );
            
            if (!isValidPassword) {
                // Incrementar intentos fallidos
                const attempts = await incrementFailedAttempts(
                    practitionerData.practitioner.id, 
                    practitionerData.auth.loginAttempts || 0
                );
                
                const remainingAttempts = 5 - attempts;
                if (remainingAttempts > 0) {
                    throw new Error(`Contraseña incorrecta. Quedan ${remainingAttempts} intentos antes del bloqueo.`);
                } else {
                    throw new Error('Cuenta bloqueada por múltiples intentos fallidos. Inténtelo en 30 minutos.');
                }
            }
            
            // 5. Login exitoso - actualizar datos
            await updateLastLogin(practitionerData.practitioner.id);
            
            // 6. Preparar datos de sesión
            const userData = {
                id: practitionerData.practitioner.id,
                name: practitionerData.practitioner.name,
                email: practitionerData.practitioner.email,
                specialty: practitionerData.practitioner.specialty,
                license: practitionerData.practitioner.license,
                loginTime: new Date().toISOString(),
                source: 'firebase'
            };
            
            // 7. Iniciar sesión
            startUserSession(userData);
            
            // 8. Guardar email si está marcado "recordar"
            const rememberCheckbox = document.getElementById('remember');
            if (rememberCheckbox && rememberCheckbox.checked) {
                localStorage.setItem('mediConnectEmail', email);
            } else {
                localStorage.removeItem('mediConnectEmail');
            }
            
            // 9. Mantener compatibilidad con localStorage (opcional)
            maintainLocalStorageCompatibility(email, practitionerData.practitioner.id);
            
            // 10. Mostrar mensaje de éxito y redirigir
            showSuccess('¡Bienvenido de vuelta!');
            
            setTimeout(() => {
                window.location.href = '../dashboard/index.html';
            }, 1000);
            
        } catch (error) {
            console.error('Error en autenticación:', error);
            showError(error.message);
            passwordInput.value = '';
        } finally {
            // Restaurar botón
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }
    });
    
    // Funciones auxiliares
    
    function startUserSession(userData) {
        // Almacenar en sessionStorage
        sessionStorage.setItem('currentMediConnectUser', JSON.stringify(userData));
        
        // También almacenar datos básicos en localStorage para persistencia
        localStorage.setItem('mediConnectLastUser', JSON.stringify({
            id: userData.id,
            name: userData.name,
            email: userData.email,
            lastLogin: userData.loginTime
        }));
    }
    
    function maintainLocalStorageCompatibility(email, practitionerId) {
        // Mantener estructura antigua para compatibilidad
        const users = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const existingUserIndex = users.findIndex(u => u.email === email);
        
        const userRecord = {
            email: email,
            practitionerId: practitionerId,
            lastLogin: new Date().toISOString(),
            source: 'firebase'
        };
        
        if (existingUserIndex >= 0) {
            users[existingUserIndex] = userRecord;
        } else {
            users.push(userRecord);
        }
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    }
    
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('visible');
        errorMessage.style.backgroundColor = '#e74c3c';
        errorMessage.style.color = 'white';
        
        setTimeout(() => {
            errorMessage.classList.remove('visible');
        }, 5000);
    }
    
    function showSuccess(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('visible');
        errorMessage.style.backgroundColor = '#27ae60';
        errorMessage.style.color = 'white';
        
        setTimeout(() => {
            errorMessage.classList.remove('visible');
        }, 3000);
    }
    
    // Cargar email guardado si existe
    const savedEmail = localStorage.getItem('mediConnectEmail');
    if (savedEmail) {
        emailInput.value = savedEmail;
        const rememberCheckbox = document.getElementById('remember');
        if (rememberCheckbox) {
            rememberCheckbox.checked = true;
        }
    }
    
    // Función para recuperar contraseña (para implementar después)
    window.initPasswordRecovery = function() {
        // Implementar recuperación de contraseña
        console.log('Funcionalidad de recuperación de contraseña pendiente');
    };
});

// Funciones globales para uso externo

// Verificar si hay una sesión activa
function checkActiveSession() {
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser') || 'null');
    return userData;
}

// Cerrar sesión
function logout() {
    sessionStorage.removeItem('currentMediConnectUser');
    localStorage.removeItem('mediConnectLastUser');
    window.location.href = '../auth/login.html';
}

// Obtener datos del usuario actual
function getCurrentUser() {
    return checkActiveSession();
}