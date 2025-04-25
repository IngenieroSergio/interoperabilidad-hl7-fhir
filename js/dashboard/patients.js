document.addEventListener('DOMContentLoaded', function() {
    // Verificar autenticación
    const userData = JSON.parse(sessionStorage.getItem('currentMediConnectUser'));
    if (!userData) {
        window.location.href = '../auth/login.html';
        return;
    }

    // Configuración FHIR
    const FHIR_SERVER = 'http://localhost:8080/fhir';
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

    // Cargar pacientes desde FHIR
    // En patients.js, reemplaza la función loadPatients con esta versión mejorada
// Versión final de loadPatients con múltiples estrategias de búsqueda
async function loadPatients() {
    try {
        showLoadingState();
        let patients = [];
        
        // Estrategia 1: Buscar a través de PractitionerRole (recomendado)
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
        
        // Estrategia 2: Si no hay resultados, buscar todos los pacientes (para desarrollo)
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
            const name = patient.name?.[0]?.text || 
                        `${patient.name?.[0]?.given?.join(' ')} ${patient.name?.[0]?.family}` || 
                        'Nombre no disponible';
            
            const identifier = patient.identifier?.[0]?.value || 'N/A';
            const gender = getGenderDisplay(patient.gender);
            const birthDate = patient.birthDate ? calculateAge(patient.birthDate) : 'N/A';
            const phone = patient.telecom?.find(t => t.system === 'phone')?.value || 'N/A';
            
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
                    const name = patient.name?.[0]?.text || 
                                `${patient.name?.[0]?.given?.join(' ')} ${patient.name?.[0]?.family}` || '';
                    const identifier = patient.identifier?.[0]?.value || '';
                    
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
        
        // Nuevo paciente
        document.getElementById('add-patient-btn').addEventListener('click', () => {
            openNewPatientModal();
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
            const response = await fetch(`${FHIR_SERVER}/Patient/${patientId}`, {
                headers: { 'Accept': 'application/fhir+json' }
            });
            
            if (!response.ok) throw new Error('Error al cargar paciente');
            
            const patient = await response.json();
            displayPatientDetails(patient);
            
        } catch (error) {
            console.error('Error cargando detalles del paciente:', error);
            showError('Error al cargar detalles del paciente');
        }
    }

    // Mostrar detalles en modal
    function displayPatientDetails(patient) {
        const modal = document.getElementById('patient-detail-modal');
        const name = patient.name?.[0]?.text || 
                   `${patient.name?.[0]?.given?.join(' ')} ${patient.name?.[0]?.family}` || 
                   'Nombre no disponible';
        
        // Actualizar información del paciente
        document.getElementById('detail-patient-avatar').textContent = getInitials(name);
        document.getElementById('detail-patient-name').textContent = name;
        
        const gender = getGenderDisplay(patient.gender);
        const age = patient.birthDate ? calculateAge(patient.birthDate) : 'N/A';
        document.getElementById('detail-patient-gender-age').textContent = `${gender} • ${age} años`;
        
        const identifier = patient.identifier?.[0]?.value || 'N/A';
        document.getElementById('detail-patient-id').textContent = `ID: ${identifier}`;
        
        // Información personal
        document.getElementById('detail-birthdate').textContent = 
            patient.birthDate ? formatDate(patient.birthDate) : 'N/A';
        
        document.getElementById('detail-phone').textContent = 
            patient.telecom?.find(t => t.system === 'phone')?.value || 'N/A';
        
        document.getElementById('detail-address').textContent = 
            patient.address?.[0]?.text || 'N/A';
        
        // Mostrar modal
        modal.style.display = 'flex';
        
        // Configurar tabs
        setupTabs();
        
        // Configurar botones
        document.getElementById('edit-patient-btn').onclick = () => editPatient(patient.id);
        document.getElementById('new-encounter-btn').onclick = () => newEncounter(patient.id);
        
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

    // Función para abrir modal de nuevo paciente (similar a dashboard.js)
    function openNewPatientModal() {
        const modal = document.getElementById('new-patient-modal');
        modal.style.display = 'flex';
        
        document.getElementById('patient-form').reset();
        
        const defaultDate = new Date();
        defaultDate.setFullYear(defaultDate.getFullYear() - 18);
        document.getElementById('patient-birthdate').valueAsDate = defaultDate;
        
        document.querySelector('#new-patient-modal .close-modal').onclick = () => {
            modal.style.display = 'none';
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };
    }

    // Función para editar paciente (similar a dashboard.js)
    function editPatient(patientId) {
        alert(`Editar paciente con ID: ${patientId}`);
        // Implementar lógica de edición similar a nuevo paciente
    }

    // Función para nueva consulta
    function newEncounter(patientId) {
        alert(`Nueva consulta para paciente con ID: ${patientId}`);
        // Implementar lógica para crear nuevo encuentro/consulta
    }
});