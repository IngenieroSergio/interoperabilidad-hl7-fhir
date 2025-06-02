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

    // Configurar FHIR y Firebase
    const FHIR_SERVER = 'http://localhost:8080/fhir';
    const FIREBASE_URL = 'https://hapi-fhir-16ed2-default-rtdb.firebaseio.com';
    const practitionerId = userData.id;

    // Cargar datos del dashboard
    loadDashboardData(practitionerId);

    // Manejadores de botones
    document.getElementById('new-patient-btn').addEventListener('click', () => {
        openNewPatientModal();
    });

    document.getElementById('new-appointment-btn').addEventListener('click', () => {
        openNewAppointmentModal();
    });

    // Cerrar sesión
    document.querySelector('.logout-btn').addEventListener('click', function(e) {
        e.preventDefault();
        sessionStorage.removeItem('currentMediConnectUser');
        window.location.href = '../auth/login.html';
    });

    // Función para abrir modal de nuevo paciente
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

    // Función para abrir modal de nueva cita
    function openNewAppointmentModal() {
        // Implementar lógica para nueva cita
        alert('Funcionalidad de nueva cita será implementada próximamente');
    }

    // Manejador del formulario de paciente
    document.getElementById('patient-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
        if (!userData) {
            showError('Sesión expirada. Por favor inicie sesión nuevamente.');
            return;
        }

        // Mostrar indicador de carga
        const submitButton = this.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        submitButton.textContent = 'Registrando...';
        submitButton.disabled = true;

        try {
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

            // Crear recurso Patient para FHIR
            const fhirPatient = createFhirPatientResource(patientData);
            
            // Paso 1: Registrar en HAPI FHIR local
            const fhirResponse = await fetch(`${FHIR_SERVER}/Patient`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/fhir+json',
                    'Accept': 'application/fhir+json'
                },
                body: JSON.stringify(fhirPatient)
            });

            if (!fhirResponse.ok) {
                const error = await fhirResponse.json();
                throw new Error(error.issue?.[0]?.details?.text || 'Error al registrar paciente en FHIR');
            }

            const newPatient = await fhirResponse.json();
            
            // Paso 2: Registrar en Firebase como respaldo
            await registerPatientInFirebase(newPatient, patientData, userData.id);
            
            // Paso 3: Crear relación Practitioner-Patient
            await linkPatientToPractitioner(newPatient.id, userData.id);
            
            // Cerrar modal y actualizar lista
            document.getElementById('new-patient-modal').style.display = 'none';
            showSuccess('Paciente registrado exitosamente en FHIR y Firebase');
            
            // Actualizar dashboard
            await loadDashboardData(userData.id);
            
        } catch (error) {
            console.error('Error registrando paciente:', error);
            showError(error.message || 'Error al registrar paciente');
        } finally {
            // Restaurar botón
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }
    });

    // Función para registrar paciente en Firebase
    async function registerPatientInFirebase(fhirPatient, originalData, practitionerId) {
        try {
            const firebasePatientData = {
                // Datos del paciente
                patient: {
                    id: fhirPatient.id,
                    fhirServerId: fhirPatient.id,
                    identifier: originalData.identifier,
                    name: {
                        given: originalData.givenName,
                        family: originalData.familyName,
                        fullName: `${originalData.givenName} ${originalData.familyName}`
                    },
                    gender: originalData.gender,
                    birthDate: originalData.birthDate,
                    phone: originalData.phone || null,
                    address: originalData.address || null,
                    active: true
                },
                // Relación con el médico
                practitioner: {
                    id: practitionerId,
                    assignedDate: new Date().toISOString()
                },
                // Metadatos
                metadata: {
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: 'dashboard_form',
                    registeredBy: practitionerId,
                    status: 'active'
                }
            };

            // Registrar paciente en Firebase
            const patientResponse = await fetch(`${FIREBASE_URL}/patients/${fhirPatient.id}.json`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(firebasePatientData)
            });

            if (!patientResponse.ok) {
                throw new Error('Error al registrar paciente en Firebase');
            }

            // Crear índice por médico para consultas rápidas
            const practitionerIndex = {
                patientId: fhirPatient.id,
                patientName: firebasePatientData.patient.name.fullName,
                assignedDate: new Date().toISOString(),
                active: true
            };

            await fetch(`${FIREBASE_URL}/practitioner_patients/${practitionerId}/${fhirPatient.id}.json`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(practitionerIndex)
            });

            // Crear índice por identificador para búsquedas
            const identifierKey = originalData.identifier.replace(/[.#$[\]]/g, '_');
            const identifierIndex = {
                patientId: fhirPatient.id,
                practitionerId: practitionerId,
                registrationDate: new Date().toISOString()
            };

            await fetch(`${FIREBASE_URL}/patient_identifiers/${identifierKey}.json`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(identifierIndex)
            });

        } catch (error) {
            console.error('Error registrando en Firebase:', error);
            // No lanzamos error aquí para no interrumpir el registro en FHIR
            console.warn('Paciente registrado en FHIR pero falló el respaldo en Firebase');
        }
    }

    // Función principal para cargar datos del dashboard
    async function loadDashboardData(practitionerId) {
        try {
            showLoadingState();
            
            // Cargar datos desde FHIR primero, con Firebase como respaldo
            const [patients, appointments, activity] = await Promise.allSettled([
                fetchPatientsWithFallback(practitionerId),
                fetchAppointmentsWithFallback(practitionerId),
                fetchRecentActivityWithFallback(practitionerId)
            ]);

            // Actualizar widgets con los datos obtenidos
            if (patients.status === 'fulfilled') {
                updatePatientWidget(patients.value);
            } else {
                console.error('Error cargando pacientes:', patients.reason);
                updatePatientWidget([]);
            }

            if (appointments.status === 'fulfilled') {
                updateAppointmentWidget(appointments.value);
            } else {
                console.error('Error cargando citas:', appointments.reason);
                updateAppointmentWidget([]);
            }

            if (activity.status === 'fulfilled') {
                updateActivityWidget(activity.value);
            } else {
                console.error('Error cargando actividad:', activity.reason);
                updateActivityWidget([]);
            }

            hideLoadingState();
            
        } catch (error) {
            console.error('Error cargando datos del dashboard:', error);
            hideLoadingState();
            showError('Error al cargar datos. Algunos datos pueden estar desactualizados.');
        }
    }

    // Obtener pacientes con fallback a Firebase
    async function fetchPatientsWithFallback(practitionerId) {
        try {
            // Intentar FHIR primero
            return await fetchPatients(practitionerId);
        } catch (fhirError) {
            console.warn('FHIR no disponible, intentando Firebase:', fhirError);
            
            try {
                // Intentar Firebase como respaldo
                return await fetchPatientsFromFirebase(practitionerId);
            } catch (firebaseError) {
                console.error('Firebase tampoco disponible:', firebaseError);
                throw new Error('No se pudieron cargar los pacientes desde ninguna fuente');
            }
        }
    }

    // Obtener pacientes desde Firebase
    async function fetchPatientsFromFirebase(practitionerId) {
        const response = await fetch(`${FIREBASE_URL}/practitioner_patients/${practitionerId}.json`);
        
        if (!response.ok) {
            throw new Error('Error al cargar pacientes desde Firebase');
        }
        
        const patientIndex = await response.json();
        if (!patientIndex) return [];

        // Obtener detalles de cada paciente
        const patientPromises = Object.keys(patientIndex).map(async (patientId) => {
            try {
                const patientResponse = await fetch(`${FIREBASE_URL}/patients/${patientId}.json`);
                if (patientResponse.ok) {
                    const patientData = await patientResponse.json();
                    return transformFirebasePatientToFhir(patientData);
                }
                return null;
            } catch (error) {
                console.error(`Error cargando paciente ${patientId}:`, error);
                return null;
            }
        });

        const patients = await Promise.all(patientPromises);
        return patients.filter(p => p !== null);
    }

    // Transformar datos de Firebase a formato FHIR
    function transformFirebasePatientToFhir(firebasePatient) {
        return {
            id: firebasePatient.patient.id,
            resourceType: "Patient",
            name: [{
                text: firebasePatient.patient.name.fullName,
                given: [firebasePatient.patient.name.given],
                family: firebasePatient.patient.name.family
            }],
            gender: firebasePatient.patient.gender,
            birthDate: firebasePatient.patient.birthDate,
            identifier: [{
                value: firebasePatient.patient.identifier
            }],
            telecom: firebasePatient.patient.phone ? [{
                system: "phone",
                value: firebasePatient.patient.phone
            }] : [],
            address: firebasePatient.patient.address ? [{
                text: firebasePatient.patient.address
            }] : [],
            _firebaseSource: true
        };
    }

    // Obtener citas con fallback
    async function fetchAppointmentsWithFallback(practitionerId) {
        try {
            return await fetchAppointments(practitionerId);
        } catch (error) {
            console.warn('Error cargando citas desde FHIR:', error);
            // Aquí podrías implementar respaldo en Firebase para citas
            return [];
        }
    }

    // Obtener actividad con fallback
    async function fetchRecentActivityWithFallback(practitionerId) {
        try {
            return await fetchRecentActivity(practitionerId);
        } catch (error) {
            console.warn('Error cargando actividad desde FHIR:', error);
            // Aquí podrías implementar respaldo en Firebase para actividad
            return [];
        }
    }

    // Funciones originales de FHIR
    async function fetchPatients(practitionerId) {
        const response = await fetch(`${FHIR_SERVER}/Patient?_has:PractitionerRole:practitioner:_id=${practitionerId}&_count=10`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) throw new Error('Error al cargar pacientes desde FHIR');
        
        const data = await response.json();
        return data.entry?.map(entry => entry.resource) || [];
    }

    async function fetchAppointments(practitionerId) {
        const now = new Date().toISOString();
        const response = await fetch(`${FHIR_SERVER}/Appointment?actor=Practitioner/${practitionerId}&date=ge${now}&_count=5&_sort=date`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) throw new Error('Error al cargar citas');
        
        const data = await response.json();
        return data.entry?.map(entry => entry.resource) || [];
    }

    async function fetchRecentActivity(practitionerId) {
        const response = await fetch(`${FHIR_SERVER}/AuditEvent?agent:Practitioner=${practitionerId}&_count=5&_sort=-date`, {
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) throw new Error('Error al cargar actividad');
        
        const data = await response.json();
        return data.entry?.map(entry => entry.resource) || [];
    }

    // Funciones auxiliares
    function createFhirPatientResource(patientData) {
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

        if (patientData.phone) {
            patientResource.telecom.push({
                system: "phone",
                value: patientData.phone,
                use: "home"
            });
        }

        if (patientData.address) {
            patientResource.address.push({
                use: "home",
                text: patientData.address
            });
        }

        return patientResource;
    }

    async function linkPatientToPractitioner(patientId, practitionerId) {
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

        const response = await fetch(`${FHIR_SERVER}/PractitionerRole`, {
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

    // Funciones de UI
    function updatePatientWidget(patients) {
        const totalPatientsElement = document.getElementById('total-patients');
        const recentPatientsElement = document.getElementById('recent-patients');
        
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
        patients.slice(0, 5).forEach(patient => {
            const name = patient.name?.[0]?.text || 
                        `${patient.name?.[0]?.given?.join(' ')} ${patient.name?.[0]?.family}` || 
                        'Paciente sin nombre';
            
            const birthDate = patient.birthDate ? new Date(patient.birthDate).toLocaleDateString() : 'N/A';
            const gender = patient.gender === 'male' ? 'Masculino' : patient.gender === 'female' ? 'Femenino' : 'Desconocido';
            const sourceIndicator = patient._firebaseSource ? '🔄' : '🌐';
            
            patientsHTML += `
                <div class="patient-item">
                    <div class="patient-avatar">${getInitials(name)}</div>
                    <div class="patient-info">
                        <div class="patient-name">${name} ${sourceIndicator}</div>
                        <div class="patient-meta">${gender} • ${birthDate}</div>
                    </div>
                </div>
            `;
        });
        
        recentPatientsElement.innerHTML = patientsHTML;
    }

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

    // Estados de carga
    function showLoadingState() {
        const widgets = document.querySelectorAll('.widget-content');
        widgets.forEach(widget => {
            widget.style.opacity = '0.6';
        });
    }

    function hideLoadingState() {
        const widgets = document.querySelectorAll('.widget-content');
        widgets.forEach(widget => {
            widget.style.opacity = '1';
        });
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

    function showSuccess(message) {
        // Implementar notificación de éxito
        console.log('✅', message);
        // Aquí puedes agregar un toast o modal de éxito
    }

    function showError(message) {
        // Implementar notificación de error
        console.error('❌', message);
        // Aquí puedes agregar un toast o modal de error
    }
});