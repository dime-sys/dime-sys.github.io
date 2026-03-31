import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const getAuthToken = () => localStorage.getItem("authToken");

export const getAuthHeaders = () => {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export const login = async (username, password) => {
  const response = await axios.post(`${API}/auth/login`, { username, password });
  return response.data;
};

export const checkIdentifier = async (identifier) => {
  const response = await axios.post(`${API}/auth/check`, { identifier });
  return response.data;
};

export const getMe = async () => {
  const response = await axios.get(`${API}/auth/me`, { headers: getAuthHeaders() });
  return response.data;
};

export const logout = async () => {
  await axios.post(`${API}/auth/logout`, {}, { headers: getAuthHeaders() });
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const getUsers = async () => {
  const response = await axios.get(`${API}/users/`, { headers: getAuthHeaders() });
  return response.data;
};

export const createUser = async (data) => {
  const response = await axios.post(`${API}/users/`, data, { headers: getAuthHeaders() });
  return response.data;
};

export const updateUser = async (userId, data) => {
  const response = await axios.put(`${API}/users/${userId}`, data, { headers: getAuthHeaders() });
  return response.data;
};

export const deleteUser = async (userId) => {
  const response = await axios.delete(`${API}/users/${userId}`, { headers: getAuthHeaders() });
  return response.data;
};

export const getPendingUsers = async () => {
  const response = await axios.get(`${API}/users/pending`, { headers: getAuthHeaders() });
  return response.data;
};

export const approvePendingUser = async (pendingId, data) => {
  const response = await axios.post(`${API}/users/pending/${pendingId}/approve`, data, { headers: getAuthHeaders() });
  return response.data;
};

export const rejectPendingUser = async (pendingId) => {
  const response = await axios.delete(`${API}/users/pending/${pendingId}`, { headers: getAuthHeaders() });
  return response.data;
};

export const preregisterUser = async (data) => {
  const response = await axios.post(`${API}/users/preregister`, data, { headers: getAuthHeaders() });
  return response.data;
};

// ── File upload ───────────────────────────────────────────────────────────────

export const uploadFile = async (file, metadata) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("metadata", JSON.stringify(metadata));

  return await axios.post(`${API}/upload/`, formData, { headers: getAuthHeaders() });
};

export const uploadFileToProject = async (file, metadata, projectId, nombreProceso, commitmentSchedule) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("metadata", JSON.stringify(metadata));
  if (projectId) {
    formData.append("project_id", projectId);
  }
  if (nombreProceso) {
    formData.append("nombre_del_proceso", nombreProceso);
  }
  if (commitmentSchedule) {
    formData.append("commitment_schedule", JSON.stringify(commitmentSchedule));
  }

  return await axios.post(`${API}/upload/`, formData, { headers: getAuthHeaders() });
};

// Configuration endpoints
export const getProjectLevels = async () => {
  try {
    const response = await axios.get(`${API}/config/project-levels`);
    return response.data;
  } catch (error) {
    console.error('Error getting project levels:', error);
    throw error;
  }
};

export const updateProjectLevels = async (maxLevels, levelNames, levelAllowFiles) => {
  try {
    const response = await axios.put(`${API}/config/project-levels`, {
      max_levels: maxLevels,
      level_names: levelNames,
      level_allow_files: levelAllowFiles
    });
    return response.data;
  } catch (error) {
    console.error('Error updating project levels:', error);
    throw error;
  }
};

export const createProject = async (name, parentId = null) => {
  try {
    const params = new URLSearchParams();
    params.append('name', name);
    if (parentId) params.append('parent_id', parentId);
    
    const response = await axios.post(`${API}/projects/?${params.toString()}`, {}, { headers: getAuthHeaders() });
    return response.data;
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
};

export const getProjects = async () => {
  try {
    const response = await axios.get(`${API}/projects/`, { headers: getAuthHeaders() });
    return response.data;
  } catch (error) {
    console.error('Error getting projects:', error);
    throw error;
  }
};

export const getProcesses = async () => {
  try {
    const response = await axios.get(`${API}/upload/`, { headers: getAuthHeaders() });
    return response.data;
  } catch (error) {
    console.error('Error getting processes:', error);
    throw error;
  }
};