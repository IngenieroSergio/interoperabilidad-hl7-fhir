document.addEventListener('DOMContentLoaded', function() {
    // Verificar autenticación
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
    if (!userData) {
        window.location.href = '../auth/login.html';
        return;
    }

    // Configuración FHIR y Firebase
    const FHIR_SERVER = 'http://localhost:8080/fhir';
    const FIREBASE_URL = 'https://hapi-fhir-16ed2-default-rtdb.firebaseio.com';
    const PRACTITIONER_ID = userData.id;
    let currentPage = 1;
    const patientsPerPage = 10;
    let totalPatients = 0;
    let allPatients = [];

    // Elementos del DOM
    const patientsTable = document.getElementById('patients-table').querySelector('tbody');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    const searchInput = document.getElementById('patient-search');

    // Inicializar
    loadPatients();
    setupEventListeners();

    // Cargar pacientes desde múltiples fuentes
    async function loadPatients() {
        try {
            showLoadingState();
            let patients = [];
            
            // Estrategia 1: Cargar desde Firebase
            try {
                console.log('Intentando cargar desde Firebase...');
                patients = await loadPatientsFromFirebase();
                if (patients.length > 0) {
                    console.log(`Cargados ${patients.length} pacientes desde Firebase`);
                }
            } catch (e) {
                console.log('Error cargando desde Firebase:', e);
            }
            
            // Estrategia 2: Si no hay datos en Firebase, cargar desde localStorage
            if (patients.length === 0) {
                try {
                    console.log('Intentando cargar desde localStorage...');
                    patients = loadPatientsFromLocalStorage();
                    if (patients.length > 0) {
                        console.log(`Cargados ${patients.length} pacientes desde localStorage`);
                    }
                } catch (e) {
                    console.log('Error cargando desde localStorage:', e);
                }
            }
            
            // Estrategia 3: Si no hay datos locales, cargar desde FHIR
            if (patients.length === 0) {
                try {
                    console.log('Intentando cargar desde servidor FHIR...');
                    patients = await loadPatientsFromFHIR();
                    if (patients.length > 0) {
                        console.log(`Cargados ${patients.length} pacientes desde FHIR`);
                        // Guardar en localStorage como backup
                        savePatientsToLocalStorage(patients);
                    }
                } catch (e) {
                    console.log('Error cargando desde FHIR:', e);
                }
            }
            
            allPatients = patients;
            totalPatients = patients.length;
            
            if (patients.length === 0) {
                showInfo('No se encontraron pacientes. Registre nuevos pacientes para comenzar.');
            }
            
            updatePatientsTable();
            updatePaginationControls();
            
        } catch (error) {
            console.error('Error en loadPatients:', error);
            showError(`Error al cargar pacientes: ${error.message}`);
        }
    }

    // Cargar pacientes desde Firebase
    async function loadPatientsFromFirebase() {
        const response = await fetch(`${FIREBASE_URL}/patients.json`);
        if (!response.ok) {
            throw new Error('Error al conectar con Firebase');
        }
        
        const data = await response.json();
        if (!data) return [];
        
        // Convertir objeto de Firebase a array, extrayendo los datos del paciente correctamente
        return Object.keys(data).map(key => {
            const patientData = data[key];
            // Los datos reales del paciente están en patientData.patient
            const patient = patientData.patient;
            
            return {
                id: key,
                // Extraer todos los campos del objeto patient
                ...patient,
                // Asegurar que el ID esté disponible
                patientId: patient.id || key,
                // Información adicional de metadata si es necesaria
                metadata: patientData.metadata,
                practitioner: patientData.practitioner
            };
        });
    }

    // Cargar pacientes desde localStorage
    function loadPatientsFromLocalStorage() {
        const patientsData = localStorage.getItem('mediconnect_patients');
        if (!patientsData) return [];
        
        try {
            return JSON.parse(patientsData);
        } catch (e) {
            console.error('Error parseando datos de localStorage:', e);
            return [];
        }
    }

    // Guardar pacientes en localStorage
    function savePatientsToLocalStorage(patients) {
        try {
            localStorage.setItem('mediconnect_patients', JSON.stringify(patients));
            console.log('Pacientes guardados en localStorage como backup');
        } catch (e) {
            console.error('Error guardando en localStorage:', e);
        }
    }

    // Cargar pacientes desde servidor FHIR (método original)
    async function loadPatientsFromFHIR() {
        let patients = [];
        
        // Estrategia 1: Buscar a través de PractitionerRole
        try {
            const rolesResponse = await fetch(
                `${FHIR_SERVER}/PractitionerRole?practitioner=${PRACTITIONER_ID}&_count=100`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (rolesResponse.ok) {
                const rolesData = await rolesResponse.json();
                const patientIds = rolesData.entry
                    ?.map(entry => entry.resource.patient?.reference?.split('/')[1])
                    .filter(id => id) || [];
                
                if (patientIds.length > 0) {
                    const patientsResponse = await fetch(
                        `${FHIR_SERVER}/Patient?_id=${patientIds.join(',')}&_count=100`,
                        { headers: { 'Accept': 'application/fhir+json' } }
                    );
                    
                    if (patientsResponse.ok) {
                        const patientsData = await patientsResponse.json();
                        patients = patientsData.entry?.map(entry => entry.resource) || [];
                    }
                }
            }
        } catch (e) {
            console.log('Búsqueda por PractitionerRole falló, intentando método alternativo...', e);
        }
        
        // Estrategia 2: Si no hay resultados, buscar todos los pacientes
        if (patients.length === 0) {
            const allPatientsResponse = await fetch(
                `${FHIR_SERVER}/Patient?_count=100`,
                { headers: { 'Accept': 'application/fhir+json' } }
            );
            
            if (allPatientsResponse.ok) {
                const allPatientsData = await allPatientsResponse.json();
                patients = allPatientsData.entry?.map(entry => entry.resource) || [];
            }
        }
        
        return patients;
    }

    function showInfo(message) {
        patientsTable.innerHTML = `
            <tr>
                <td colspan="6" class="info-state">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <p>${message}</p>
                </td>
            </tr>
        `;
    }

    // Mostrar estado de carga
    function showLoadingState() {
        patientsTable.innerHTML = `
            <tr class="loading-row">
                <td colspan="6">
                    <div class="loading-spinner"></div>
                    <span>Cargando pacientes...</span>
                </td>
            </tr>
        `;
    }

    // Actualizar tabla de pacientes
    function updatePatientsTable(filteredPatients = null) {
        const patientsToDisplay = filteredPatients || allPatients;
        const startIndex = (currentPage - 1) * patientsPerPage;
        const endIndex = startIndex + patientsPerPage;
        const paginatedPatients = patientsToDisplay.slice(startIndex, endIndex);
        
        if (paginatedPatients.length === 0) {
            patientsTable.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        No se encontraron pacientes
                    </td>
                </tr>
            `;
            return;
        }
        
        patientsTable.innerHTML = paginatedPatients.map(patient => {
            // Manejar diferentes formatos de datos (Firebase/localStorage vs FHIR)
            const name = getPatientName(patient);
            const identifier = getPatientIdentifier(patient);
            const gender = getGenderDisplay(patient.gender);
            const birthDate = patient.birthDate ? calculateAge(patient.birthDate) : 'N/A';
            const phone = getPatientPhone(patient);
            
            return `
                <tr data-patient-id="${patient.id}">
                    <td>
                        <div class="patient-avatar">${getInitials(name)}</div>
                        ${name}
                    </td>
                    <td>${identifier}</td>
                    <td>${gender}</td>
                    <td>${birthDate}</td>
                    <td>${phone}</td>
                    <td>
                        <button class="action-btn view-btn" title="Ver detalles">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="action-btn edit-btn" title="Editar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="action-btn delete-btn" title="Eliminar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3,6 5,6 21,6"></polyline>
                                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Agregar event listeners a los botones
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const patientId = e.target.closest('tr').dataset.patientId;
                viewPatientDetails(patientId);
            });
        });
        
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const patientId = e.target.closest('tr').dataset.patientId;
                editPatient(patientId);
            });
        });
        
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const patientId = e.target.closest('tr').dataset.patientId;
                const patientName = getPatientName(allPatients.find(p => p.id === patientId));
                deletePatient(patientId, patientName);
            });
        });
    }

    // Funciones auxiliares para manejar diferentes formatos de datos
    function getPatientName(patient) {
        // Formato Firebase (estructura anidada name)
        if (patient.name && typeof patient.name === 'object') {
            return patient.name.fullName || 
                   `${patient.name.given} ${patient.name.family}` || 
                   'Nombre no disponible';
        }
        
        // Formato FHIR
        if (patient.name && Array.isArray(patient.name)) {
            return patient.name[0]?.text || 
                   `${patient.name[0]?.given?.join(' ')} ${patient.name[0]?.family}` || 
                   'Nombre no disponible';
        }
        
        // Formato Firebase/localStorage alternativo
        if (patient.firstName && patient.lastName) {
            return `${patient.firstName} ${patient.lastName}`;
        }
        
        if (patient.name && typeof patient.name === 'string') {
            return patient.name;
        }
        
        return 'Nombre no disponible';
    }

    function getPatientIdentifier(patient) {
        // Formato Firebase/localStorage (campo directo identifier)
        if (patient.identifier) {
            return patient.identifier;
        }
        
        // Formato FHIR
        if (patient.identifier && Array.isArray(patient.identifier)) {
            return patient.identifier[0]?.value || 'N/A';
        }
        
        // Campos alternativos
        return patient.documentNumber || patient.id || 'N/A';
    }

    function getPatientPhone(patient) {
        // Formato Firebase/localStorage (campo directo phone)
        if (patient.phone) {
            return patient.phone;
        }
        
        // Formato FHIR
        if (patient.telecom && Array.isArray(patient.telecom)) {
            return patient.telecom.find(t => t.system === 'phone')?.value || 'N/A';
        }
        
        // Campo alternativo
        return patient.phoneNumber || 'N/A';
    }

    function getPatientAddress(patient) {
        // Formato Firebase/localStorage (campo directo address)
        if (patient.address && typeof patient.address === 'string') {
            return patient.address;
        }
        
        // Formato FHIR
        if (patient.address && Array.isArray(patient.address)) {
            return patient.address[0]?.text || 'N/A';
        }
        
        return 'N/A';
    }

    // Configurar event listeners
    function setupEventListeners() {
        // Paginación
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                updatePatientsTable();
                updatePaginationControls();
            }
        });
        
        nextPageBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(totalPatients / patientsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                updatePatientsTable();
                updatePaginationControls();
            }
        });
        
        // Búsqueda
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            
            if (searchTerm.length > 2) {
                const filtered = allPatients.filter(patient => {
                    const name = getPatientName(patient);
                    const identifier = getPatientIdentifier(patient);
                    
                    return name.toLowerCase().includes(searchTerm) || 
                           identifier.toLowerCase().includes(searchTerm);
                });
                
                totalPatients = filtered.length;
                updatePatientsTable(filtered);
                updatePaginationControls();
            } else if (searchTerm.length === 0) {
                totalPatients = allPatients.length;
                updatePatientsTable();
                updatePaginationControls();
            }
        });
    }

    // Actualizar controles de paginación
    function updatePaginationControls() {
        const totalPages = Math.ceil(totalPatients / patientsPerPage);
        
        pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    }

    // Ver detalles del paciente
    async function viewPatientDetails(patientId) {
        try {
            // Buscar paciente en los datos cargados
            let patient = allPatients.find(p => p.id === patientId);
            
            if (!patient) {
                // Si no está en memoria, intentar cargar desde FHIR
                const response = await fetch(`${FHIR_SERVER}/Patient/${patientId}`, {
                    headers: { 'Accept': 'application/fhir+json' }
                });
                
                if (!response.ok) throw new Error('Error al cargar paciente');
                patient = await response.json();
            }
            
            displayPatientDetails(patient);
            
        } catch (error) {
            console.error('Error cargando detalles del paciente:', error);
            showError('Error al cargar detalles del paciente');
        }
    }

    // Mostrar detalles en modal
    function displayPatientDetails(patient) {
        const modal = document.getElementById('patient-detail-modal');
        const name = getPatientName(patient);
        
        // Actualizar información del paciente
        document.getElementById('detail-patient-avatar').textContent = getInitials(name);
        document.getElementById('detail-patient-name').textContent = name;
        
        const gender = getGenderDisplay(patient.gender);
        const age = patient.birthDate ? calculateAge(patient.birthDate) : 'N/A';
        document.getElementById('detail-patient-gender-age').textContent = `${gender} • ${age} años`;
        
        const identifier = getPatientIdentifier(patient);
        document.getElementById('detail-patient-id').textContent = `ID: ${identifier}`;
        
        // Información personal
        document.getElementById('detail-birthdate').textContent = 
            patient.birthDate ? formatDate(patient.birthDate) : 'N/A';
        
        document.getElementById('detail-phone').textContent = getPatientPhone(patient);
        
        document.getElementById('detail-address').textContent = getPatientAddress(patient);
        
        // Mostrar modal
        modal.style.display = 'flex';
        
        // Configurar tabs
        setupTabs();
        
        // Configurar botones
        document.getElementById('edit-patient-btn').onclick = () => editPatient(patient.id);
        document.getElementById('new-encounter-btn').onclick = () => newEncounter(patient.id);
        
        // Agregar botón de eliminar en el modal de detalles
        const modalActions = document.querySelector('#patient-detail-modal .modal-actions');
        if (modalActions && !modalActions.querySelector('.delete-patient-btn')) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger delete-patient-btn';
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3,6 5,6 21,6"></polyline>
                    <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                Eliminar Paciente
            `;
            deleteBtn.onclick = () => {
                modal.style.display = 'none';
                deletePatient(patient.id, name);
            };
            modalActions.appendChild(deleteBtn);
        }
        
        // Manejar cierre del modal
        document.querySelector('#patient-detail-modal .close-modal').onclick = () => {
            modal.style.display = 'none';
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };
    }

    // Configurar tabs en el modal
    function setupTabs() {
        const tabs = document.querySelectorAll('#patient-detail-modal .tab-btn');
        const tabContents = document.querySelectorAll('#patient-detail-modal .tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remover clase active de todos los tabs
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                // Agregar clase active al tab seleccionado
                tab.classList.add('active');
                const tabId = tab.dataset.tab;
                document.getElementById(`${tabId}-tab`).classList.add('active');
            });
        });
    }

    // Funciones auxiliares
    function getInitials(name) {
        return name.split(' ').map(part => part[0]).join('').substring(0, 2).toUpperCase();
    }

    function getGenderDisplay(gender) {
        const genderMap = {
            'male': 'Masculino',
            'female': 'Femenino',
            'other': 'Otro',
            'unknown': 'Desconocido'
        };
        return genderMap[gender] || gender;
    }

    function calculateAge(birthDate) {
        const birth = new Date(birthDate);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        
        return age;
    }

    function formatDate(dateString) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('es-ES', options);
    }

    function showError(message) {
        // Mostrar en la interfaz
        const errorElement = document.createElement('div');
        errorElement.className = 'error-state';
        errorElement.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p>${message}</p>
        `;
        
        // Limpiar la tabla y mostrar el error
        patientsTable.innerHTML = '';
        patientsTable.appendChild(document.createElement('tr')).appendChild(document.createElement('td')).appendChild(errorElement);
        
        // También mostrar en consola
        console.error('Error en la aplicación:', message);
    }

    // Función para editar paciente
    function editPatient(patientId) {
        alert(`Editar paciente con ID: ${patientId}`);
        // Implementar lógica de edición
    }

    // Función para nueva consulta
    function newEncounter(patientId) {
        alert(`Nueva consulta para paciente con ID: ${patientId}`);
        // Implementar lógica para crear nuevo encuentro/consulta
    }

    // Función para eliminar paciente
    async function deletePatient(patientId, patientName) {
        // Mostrar modal de confirmación
        const confirmModal = createConfirmationModal(
            'Eliminar Paciente',
            `¿Está seguro que desea eliminar al paciente "${patientName}"?`,
            'Esta acción no se puede deshacer y eliminará toda la información del paciente.',
            'Eliminar',
            'danger'
        );
        
        document.body.appendChild(confirmModal);
        
        // Manejar confirmación
        confirmModal.querySelector('.confirm-btn').addEventListener('click', async () => {
            try {
                document.body.removeChild(confirmModal);
                showLoadingState();
                
                // Eliminar de Firebase
                await deletePatientFromFirebase(patientId);
                
                // Eliminar de localStorage
                deletePatientFromLocalStorage(patientId);
                
                // Eliminar de FHIR si es necesario
                try {
                    await deletePatientFromFHIR(patientId);
                } catch (e) {
                    console.log('Error eliminando de FHIR (puede ser normal):', e);
                }
                
                // Actualizar la lista local
                allPatients = allPatients.filter(p => p.id !== patientId);
                totalPatients = allPatients.length;
                
                // Si estamos en la última página y ya no hay pacientes, ir a la página anterior
                const totalPages = Math.ceil(totalPatients / patientsPerPage);
                if (currentPage > totalPages && totalPages > 0) {
                    currentPage = totalPages;
                }
                
                updatePatientsTable();
                updatePaginationControls();
                
                showSuccessMessage(`Paciente "${patientName}" eliminado exitosamente`);
                
            } catch (error) {
                console.error('Error eliminando paciente:', error);
                showError(`Error al eliminar paciente: ${error.message}`);
                // Recargar datos para asegurar consistencia
                loadPatients();
            }
        });
        
        // Manejar cancelación
        confirmModal.querySelector('.cancel-btn').addEventListener('click', () => {
            document.body.removeChild(confirmModal);
        });
        
        // Cerrar modal al hacer clic fuera
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) {
                document.body.removeChild(confirmModal);
            }
        });
    }

    // Eliminar paciente de Firebase
    async function deletePatientFromFirebase(patientId) {
        const patient = allPatients.find(p => p.id === patientId);
        if (!patient) throw new Error('Paciente no encontrado');
        
        // Eliminar del nodo patients
        const deletePatientResponse = await fetch(`${FIREBASE_URL}/patients/${patientId}.json`, {
            method: 'DELETE'
        });
        
        if (!deletePatientResponse.ok) {
            throw new Error('Error eliminando paciente de Firebase');
        }
        
        // Eliminar del índice de identificadores si existe
        if (patient.identifier) {
            try {
                await fetch(`${FIREBASE_URL}/patient_identifiers/${patient.identifier}.json`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.log('Error eliminando del índice de identificadores:', e);
            }
        }
        
        // Eliminar de practitioner_patients si existe
        try {
            await fetch(`${FIREBASE_URL}/practitioner_patients/${PRACTITIONER_ID}/${patientId}.json`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.log('Error eliminando de practitioner_patients:', e);
        }
        
        console.log(`Paciente ${patientId} eliminado de Firebase`);
    }

    // Eliminar paciente de localStorage
    function deletePatientFromLocalStorage(patientId) {
        try {
            const patientsData = localStorage.getItem('mediconnect_patients');
            if (patientsData) {
                const patients = JSON.parse(patientsData);
                const updatedPatients = patients.filter(p => p.id !== patientId);
                localStorage.setItem('mediconnect_patients', JSON.stringify(updatedPatients));
                console.log(`Paciente ${patientId} eliminado de localStorage`);
            }
        } catch (e) {
            console.error('Error eliminando de localStorage:', e);
        }
    }

    // Eliminar paciente de FHIR
    async function deletePatientFromFHIR(patientId) {
        const response = await fetch(`${FHIR_SERVER}/Patient/${patientId}`, {
            method: 'DELETE',
            headers: { 'Accept': 'application/fhir+json' }
        });
        
        if (!response.ok) {
            console.log(`FHIR deletion response: ${response.status}`);
            // No lanzar error aquí ya que puede ser normal que no exista en FHIR
        } else {
            console.log(`Paciente ${patientId} eliminado de FHIR`);
        }
    }

    // Crear modal de confirmación
    function createConfirmationModal(title, message, warning, confirmText, type = 'danger') {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        `;
        
        modalContent.innerHTML = `
            <div class="modal-header" style="margin-bottom: 16px;">
                <h3 style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600;">${title}</h3>
            </div>
            <div class="modal-body" style="margin-bottom: 24px;">
                <p style="margin: 0 0 12px 0; color: #374151; line-height: 1.5;">${message}</p>
                ${warning ? `<p style="margin: 0; color: #dc2626; font-size: 14px; line-height: 1.4;"><strong>Advertencia:</strong> ${warning}</p>` : ''}
            </div>
            <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end;">
                <button class="cancel-btn" style="px: 16px; py: 8px; border: 1px solid #d1d5db; background: white; color: #374151; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">
                    Cancelar
                </button>
                <button class="confirm-btn" style="px: 16px; py: 8px; border: none; background: ${type === 'danger' ? '#dc2626' : '#059669'}; color: white; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">
                    ${confirmText}
                </button>
            </div>
        `;
        
        // Agregar efectos hover
        const cancelBtn = modalContent.querySelector('.cancel-btn');
        const confirmBtn = modalContent.querySelector('.confirm-btn');
        
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.backgroundColor = '#f3f4f6';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.backgroundColor = 'white';
        });
        
        confirmBtn.addEventListener('mouseenter', () => {
            confirmBtn.style.backgroundColor = type === 'danger' ? '#b91c1c' : '#047857';
        });
        confirmBtn.addEventListener('mouseleave', () => {
            confirmBtn.style.backgroundColor = type === 'danger' ? '#dc2626' : '#059669';
        });
        
        modal.appendChild(modalContent);
        return modal;
    }

    // Mostrar mensaje de éxito
    function showSuccessMessage(message) {
        const successElement = document.createElement('div');
        successElement.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            z-index: 9999;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        
        successElement.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20,6 9,17 4,12"></polyline>
            </svg>
            ${message}
        `;
        
        document.body.appendChild(successElement);
        
        // Remover después de 4 segundos
        setTimeout(() => {
            if (document.body.contains(successElement)) {
                document.body.removeChild(successElement);
            }
        }, 4000);
    }

    // Función adicional para debugging - puedes usarla temporalmente para ver la estructura
    function debugPatientData(patients) {
        console.log('Estructura de datos de pacientes:', patients);
        if (patients.length > 0) {
            console.log('Primer paciente:', patients[0]);
            console.log('Campos disponibles:', Object.keys(patients[0]));
        }
    }
});