import axios from "axios";

const API = "http://localhost:8000";

export const uploadFile = async (file, metadata) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("metadata", JSON.stringify(metadata));

  return await axios.post(`${API}/upload/`, formData);
};

export const uploadFileToProject = async (file, metadata, projectId) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("metadata", JSON.stringify(metadata));
  if (projectId) {
    formData.append("project_id", projectId);
  }

  return await axios.post(`${API}/upload/`, formData);
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
    
    const response = await axios.post(`${API}/projects/?${params.toString()}`, {});
    return response.data;
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
};

export const getProjects = async () => {
  try {
    const response = await axios.get(`${API}/projects/`);
    return response.data;
  } catch (error) {
    console.error('Error getting projects:', error);
    throw error;
  }
};