// Open Edit Character Modal and populate fields
function openEditCharModal(id, name, systemPrompt, temperature) {
    const modal = new bootstrap.Modal(document.getElementById('editCharacterModal'));
    
    // Set form action dynamic URL
    const form = document.getElementById('editCharForm');
    form.action = `/admin/character/edit/${id}`;
    
    // Populate form fields
    document.getElementById('edit_name').value = name;
    document.getElementById('edit_system_prompt').value = systemPrompt;
    document.getElementById('edit_temperature').value = temperature;
    
    modal.show();
}

// Open Add Topic Modal and configure character constraints
function openAddTopicModal(characterId, characterName) {
    const modal = new bootstrap.Modal(document.getElementById('addTopicModal'));
    
    document.getElementById('addTopicCharId').value = characterId;
    document.getElementById('addTopicCharName').innerText = characterName;
    
    // Clear previous inputs
    document.getElementById('topic_title').value = "";
    document.getElementById('topic_lecture').value = "";
    
    modal.show();
}

// Open Edit Topic Modal and populate inputs
function openEditTopicModal(topicId, title, lectureContent) {
    const modal = new bootstrap.Modal(document.getElementById('editTopicModal'));
    
    const form = document.getElementById('editTopicForm');
    form.action = `/admin/topic/edit/${topicId}`;
    
    document.getElementById('edit_topic_title').value = title;
    document.getElementById('edit_topic_lecture').value = lectureContent;
    
    modal.show();
}
