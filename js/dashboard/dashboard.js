document.addEventListener('DOMContentLoaded', function() {
    // Verificar autenticación
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
    if (!userData) {
        window.location.href = '../auth/login.html';
        return;
    }

    // Mostrar información del médico
    document.getElementById('doctor-name').textContent = userData.name;
    document.getElementById('sidebar-doctor-name').textContent = userData.name;
    document.getElementById('sidebar-doctor-email').textContent = userData.email;

    // Configurar FHIR
    const FHIR_SERVER = 'http://localhost:8080/fhir';
    const practitionerId = userData.id;

    // Cargar datos del dashboard
    loadDashboardData(practitionerId);

    // Manejadores de botones
    // En la función principal del dashboard.js
document.getElementById('new-patient-btn').addEventListener('click', () => {
    openNewPatientModal();
});

// Agrega estas funciones al dashboard.js

function openNewPatientModal() {
    const modal = document.getElementById('new-patient-modal');
    modal.style.display = 'flex';
    
    // Limpiar formulario al abrir
    document.getElementById('patient-form').reset();
    
    // Configurar fecha por defecto (18 años atrás)
    const defaultDate = new Date();
    defaultDate.setFullYear(defaultDate.getFullYear() - 18);
    document.getElementById('patient-birthdate').valueAsDate = defaultDate;
    
    // Manejar cierre del modal
    document.querySelector('.close-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // Cerrar al hacer clic fuera del contenido
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// Manejador del formulario de paciente
document.getElementById('patient-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
    if (!userData) {
        showError('Sesión expirada. Por favor inicie sesión nuevamente.');
        return;
    }

    // Obtener valores del formulario
    const patientData = {
        givenName: document.getElementById('patient-given-name').value.trim(),
        familyName: document.getElementById('patient-family-name').value.trim(),
        gender: document.getElementById('patient-gender').value,
        birthDate: document.getElementById('patient-birthdate').value,
        identifier: document.getElementById('patient-identifier').value.trim(),
        phone: document.getElementById('patient-phone').value.trim(),
        address: document.getElementById('patient-address').value.trim()
    };

    // Validaciones básicas
    if (!patientData.givenName || !patientData.familyName || !patientData.gender || 
        !patientData.birthDate || !patientData.identifier) {
        showError('Por favor complete todos los campos requeridos');
        return;
    }

    try {
        // Crear recurso Patient para FHIR
        const fhirPatient = createFhirPatientResource(patientData);
        
        // Enviar al servidor FHIR
        const response = await fetch('http://localhost:8080/fhir/Patient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/fhir+json',
                'Accept': 'application/fhir+json'
            },
            body: JSON.stringify(fhirPatient)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.issue?.[0]?.details?.text || 'Error al registrar paciente');
        }

        const newPatient = await response.json();
        
        // Crear relación Practitioner-Patient (usando PractitionerRole)
        await linkPatientToPractitioner(newPatient.id, userData.id);
        
        // Cerrar modal y actualizar lista
        document.getElementById('new-patient-modal').style.display = 'none';
        showSuccess('Paciente registrado exitosamente');
        
        // Actualizar lista de pacientes
        const patients = await fetchPatients(userData.id);
        updatePatientWidget(patients);
        
    } catch (error) {
        console.error('Error registrando paciente:', error);
        showError(error.message || 'Error al registrar paciente');
    }
});

function createFhirPatientResource(patientData) {
    // Construir recurso Patient según estándar FHIR
    const patientResource = {
        resourceType: "Patient",
        active: true,
        name: [{
            use: "official",
            given: [patientData.givenName],
            family: patientData.familyName
        }],
        gender: patientData.gender,
        birthDate: patientData.birthDate,
        identifier: [{
            system: "http://example.org/patient-identifier",
            value: patientData.identifier
        }],
        telecom: [],
        address: []
    };

    // Agregar teléfono si existe
    if (patientData.phone) {
        patientResource.telecom.push({
            system: "phone",
            value: patientData.phone,
            use: "home"
        });
    }

    // Agregar dirección si existe
    if (patientData.address) {
        patientResource.address.push({
            use: "home",
            text: patientData.address
        });
    }

    return patientResource;
}

async function linkPatientToPractitioner(patientId, practitionerId) {
    // Crear recurso PractitionerRole para establecer la relación
    const practitionerRole = {
        resourceType: "PractitionerRole",
        active: true,
        practitioner: {
            reference: `Practitioner/${practitionerId}`
        },
        patient: {
            reference: `Patient/${patientId}`
        },
        code: [{
            coding: [{
                system: "http://terminology.hl7.org/CodeSystem/practitioner-role",
                code: "doctor",
                display: "Doctor"
            }]
        }]
    };

    const response = await fetch('http://localhost:8080/fhir/PractitionerRole', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(practitionerRole)
    });

    if (!response.ok) {
        console.error('Error creando relación PractitionerRole:', await response.json());
        throw new Error('Error al vincular paciente con médico');
    }
}

function showSuccess(message) {
    // Implementación básica - puedes usar un toast o notificación más elegante
    alert(message);
}

function showError(message) {
    // Implementación básica - puedes mejorar esto con un modal de error
    alert(`Error: ${message}`);
}

    document.getElementById('new-appointment-btn').addEventListener('click', () => {
        // Implementar lógica para nueva cita
        alert('Funcionalidad de nueva cita será implementada');
    });

    // Cerrar sesión
    document.querySelector('.logout-btn').addEventListener('click', function(e) {
        e.preventDefault();
        sessionStorage.removeItem('currentMediConnectUser');
        window.location.href = '../auth/login.html';
    });

    // Función para cargar datos del dashboard
    async function loadDashboardData(practitionerId) {
        try {
            // 1. Cargar pacientes del médico
            const patients = await fetchPatients(practitionerId);
            updatePatientWidget(patients);
            
            // 2. Cargar citas próximas
            const appointments = await fetchAppointments(practitionerId);
            updateAppointmentWidget(appointments);
            
            // 3. Cargar actividad reciente
            const activity = await fetchRecentActivity(practitionerId);
            updateActivityWidget(activity);
            
        } catch (error) {
            console.error('Error cargando datos del dashboard:', error);
            showError('Error al cargar datos. Intente recargar la página.');
        }
    }

    // Obtener pacientes del médico desde FHIR
    async function fetchPatients(practitionerId) {
        const response = await fetch(`${FHIR_SERVER}/Patient?_has:PractitionerRole:practitioner:_id=${practitionerId}&_count=5`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) throw new Error('Error al cargar pacientes');
        
        const data = await response.json();
        return data.entry?.map(entry => entry.resource) || [];
    }

    // Obtener citas del médico desde FHIR
    async function fetchAppointments(practitionerId) {
        const now = new Date().toISOString();
        const response = await fetch(`${FHIR_SERVER}/Appointment?actor=Practitioner/${practitionerId}&date=ge${now}&_count=5&_sort=date`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) throw new Error('Error al cargar citas');
        
        const data = await response.json();
        return data.entry?.map(entry => entry.resource) || [];
    }

    // Obtener actividad reciente desde FHIR
    async function fetchRecentActivity(practitionerId) {
        const response = await fetch(`${FHIR_SERVER}/AuditEvent?agent:Practitioner=${practitionerId}&_count=5&_sort=-date`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) throw new Error('Error al cargar actividad');
        
        const data = await response.json();
        return data.entry?.map(entry => entry.resource) || [];
    }

    // Actualizar widget de pacientes
    function updatePatientWidget(patients) {
        const totalPatientsElement = document.getElementById('total-patients');
        const recentPatientsElement = document.getElementById('recent-patients');
        
        // Obtener total de pacientes (en una implementación real harías otra llamada FHIR con _summary=count)
        totalPatientsElement.textContent = patients.length;
        
        if (patients.length === 0) {
            recentPatientsElement.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <p>No se encontraron pacientes</p>
                </div>
            `;
            return;
        }
        
        let patientsHTML = '';
        patients.forEach(patient => {
            const name = patient.name?.[0]?.text || 
                        `${patient.name?.[0]?.given?.join(' ')} ${patient.name?.[0]?.family}` || 
                        'Paciente sin nombre';
            
            const birthDate = patient.birthDate ? new Date(patient.birthDate).toLocaleDateString() : 'N/A';
            const gender = patient.gender === 'male' ? 'Masculino' : patient.gender === 'female' ? 'Femenino' : 'Desconocido';
            
            patientsHTML += `
                <div class="patient-item">
                    <div class="patient-avatar">${getInitials(name)}</div>
                    <div class="patient-info">
                        <div class="patient-name">${name}</div>
                        <div class="patient-meta">${gender} • ${birthDate}</div>
                    </div>
                </div>
            `;
        });
        
        recentPatientsElement.innerHTML = patientsHTML;
    }

    // Actualizar widget de citas
    function updateAppointmentWidget(appointments) {
        const upcomingAppointmentsElement = document.getElementById('upcoming-appointments');
        
        if (appointments.length === 0) {
            upcomingAppointmentsElement.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <p>No hay citas próximas</p>
                </div>
            `;
            return;
        }
        
        let appointmentsHTML = '';
        appointments.forEach(appointment => {
            const start = appointment.start ? new Date(appointment.start).toLocaleString() : 'Fecha no definida';
            const patientId = appointment.participant?.find(p => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference?.split('/')[1];
            const patientName = appointment.description || 'Paciente no especificado';
            const status = appointment.status || 'unknown';
            
            appointmentsHTML += `
                <div class="appointment-item">
                    <div class="appointment-time">${start}</div>
                    <div class="appointment-patient">${patientName}</div>
                    <div class="appointment-status ${status}">${getStatusText(status)}</div>
                </div>
            `;
        });
        
        upcomingAppointmentsElement.innerHTML = appointmentsHTML;
    }

    // Actualizar widget de actividad
    function updateActivityWidget(activities) {
        const recentActivityElement = document.getElementById('recent-activity');
        
        if (activities.length === 0) {
            recentActivityElement.innerHTML = `
                <div class="empty-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <p>No hay actividad reciente</p>
                </div>
            `;
            return;
        }
        
        let activityHTML = '';
        activities.forEach(activity => {
            const date = activity.date ? new Date(activity.date).toLocaleString() : 'Fecha desconocida';
            const action = getActionText(activity.action);
            const description = activity.outcomeDesc || activity.description || 'Actividad sin descripción';
            
            activityHTML += `
                <div class="activity-item">
                    <div class="activity-time">${date}</div>
                    <div class="activity-action">${action}</div>
                    <div class="activity-description">${description}</div>
                </div>
            `;
        });
        
        recentActivityElement.innerHTML = activityHTML;
    }

    // Funciones auxiliares
    function getInitials(name) {
        return name.split(' ').map(part => part[0]).join('').substring(0, 2).toUpperCase();
    }

    function getStatusText(status) {
        const statusMap = {
            'booked': 'Agendada',
            'arrived': 'Presente',
            'fulfilled': 'Completada',
            'cancelled': 'Cancelada',
            'noshow': 'No asistió'
        };
        return statusMap[status] || status;
    }

    function getActionText(action) {
        const actionMap = {
            'C': 'Creación',
            'R': 'Lectura',
            'U': 'Actualización',
            'D': 'Eliminación',
            'E': 'Ejecución'
        };
        return actionMap[action] || action;
    }

    function showError(message) {
        // Implementar lógica para mostrar errores al usuario
        console.error(message);
    }
});