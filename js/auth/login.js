// js/auth/login.js
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('login-error');

    // URL base de tu servidor HAPI FHIR
    const FHIR_SERVER = 'http://localhost:8080/fhir';
    
    // Almacenamiento local para credenciales (solo para desarrollo)
    const STORAGE_KEY = 'mediconnect_users';

    // Manejar visibilidad de contraseña
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', function() {
            const input = this.previousElementSibling;
            input.type = input.type === 'password' ? 'text' : 'password';
            this.innerHTML = input.type === 'password' ? 
                '👁️' : '👁️‍🗨️';
        });
    });

    // Autenticación
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        // Validaciones básicas
        if (!email || !password) {
            showError('Por favor complete todos los campos');
            return;
        }

        try {
            // 1. Verificar si el usuario existe en FHIR
            const practitioner = await findPractitionerByEmail(email);
            
            if (!practitioner) {
                throw new Error('No existe un médico registrado con este correo');
            }

            // 2. Verificar credenciales contra las almacenadas
            const isValid = await verifyCredentials(email, password);
            
            if (!isValid) {
                throw new Error('Contraseña incorrecta');
            }

            // 3. Preparar datos de sesión
            const userData = {
                id: practitioner.id,
                name: formatPractitionerName(practitioner),
                email: email,
                specialty: getSpecialty(practitioner),
                license: getLicense(practitioner)
            };

            // 4. Iniciar sesión
            startUserSession(userData);
            
            // 5. Redirigir al dashboard
            window.location.href = '../dashboard/index.html';

        } catch (error) {
            console.error('Error en autenticación:', error);
            showError(error.message);
            passwordInput.value = '';
        }
    });

    // Funciones auxiliares

    async function findPractitionerByEmail(email) {
        // Buscar en FHIR por email (campo telecom)
        const response = await fetch(`${FHIR_SERVER}/Practitioner?telecom=${encodeURIComponent(email)}`, {
            headers: { 'Accept': 'application/fhir+json' }
        });

        if (!response.ok) throw new Error('Error al conectar con el servidor');

        const result = await response.json();
        return result.entry?.[0]?.resource || null;
    }

    async function verifyCredentials(email, password) {
        // Obtener credenciales almacenadas (del registro)
        const users = JSON.parse(localStorage.getItem(STORAGE_KEY) || []);
        const user = users.find(u => u.email === email);
        
        // Comparación directa solo para DEMO (en producción usar hash)
        return user && user.password === password;
    }

    function formatPractitionerName(practitioner) {
        if (practitioner.name?.[0]?.text) return practitioner.name[0].text;
        
        const given = practitioner.name?.[0]?.given?.join(' ') || '';
        const family = practitioner.name?.[0]?.family || '';
        return `${given} ${family}`.trim() || 'Médico';
    }

    function getSpecialty(practitioner) {
        return practitioner.qualification?.[0]?.code?.coding?.[0]?.display || 'Medicina General';
    }

    function getLicense(practitioner) {
        const license = practitioner.identifier?.find(id => 
            id.system.includes('medical-license')
        );
        return license?.value || '';
    }

    function startUserSession(userData) {
        // Almacenar en sessionStorage
        sessionStorage.setItem('currentMediConnectUser', JSON.stringify(userData));
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('visible');
        setTimeout(() => errorMessage.classList.remove('visible'), 5000);
    }

    // Cargar email guardado si existe
    const savedEmail = localStorage.getItem('mediConnectEmail');
    if (savedEmail) {
        emailInput.value = savedEmail;
        document.getElementById('remember').checked = true;
    }
});