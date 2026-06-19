// ============================================================================
// Module: app.js
// Purpose: Manages UI events, date calculations, and application flow.
// ============================================================================

/**
 * Initializes the application state once the DOM content is fully loaded.
 * Sets the minimum selectable start date to today.
 */
document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById('startDate');
    startDateInput.setAttribute('min', new Date().toISOString().split('T')[0]);
});

/**
 * Updates the minimum allowed end date based on the selected start date.
 */
function updateMinEndDate() {
    const startVal = document.getElementById('startDate').value;
    const endDateInput = document.getElementById('endDate');

    if (!startVal) {
        endDateInput.min = "";
        return;
    }

    const minEnd = new Date(startVal);
    minEnd.setDate(minEnd.getDate() + 1);
    endDateInput.min = minEnd.toISOString().split('T')[0];

    if (endDateInput.value && endDateInput.value <= startVal) {
        endDateInput.value = '';
    }
    updateRouteSummary();
}

/**
 * Calculates and displays the trip duration, passenger count, and summary.
 */
function updateRouteSummary() {
    const startVal = document.getElementById('startDate').value;
    const endVal = document.getElementById('endDate').value;
    const passInput = document.getElementById('passengers').value;
    const display = document.getElementById('summaryDisplay');

    let lines = [];
    
    // Display the selected route if both origin and destination are available
    if (tripData.origin && tripData.destination) {
        lines.push(`Route: ${tripData.origin} ➔ ${tripData.destination}`);
    }

    // Calculate and format travel dates and total duration
    if (startVal && endVal) {
        lines.push(`Dates: ${startVal} to ${endVal}`);
        const start = new Date(startVal);
        const end = new Date(endVal);
        const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
        lines.push(`Duration: ${diffDays} nights, ${diffDays + 1} days`);
    }

    // Display passenger count, defaulting to 1 if empty or invalid
    const pass = passInput === '' ? 1 : Math.max(1, Math.floor(passInput));
    lines.push(`Travelers: ${pass}`);

    display.innerHTML = lines.join('<br>');
}

/**
 * Handles the final submission of the travel route with strict validation.
 */
function submitTrip() {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;
    const passInput = document.getElementById('passengers').value;
    const pass = passInput === '' ? 1 : Math.floor(passInput);

    /* 1. Validate if essential fields are empty */
    if (!tripData.origin || !tripData.destination || !start || !end) {
        alert("Please fill in Origin, Destination, and all required dates.");
        return;
    }

    /* 2. Validate passengers count (must be at least 1) */
    if (pass < 1) {
        alert("Enter a valid number of travelers (at least 1).");
        return;
    }

    /* 3. Logical validation: Origin and Destination must be different */
    if (tripData.origin === tripData.destination) {
        alert("Origin and Destination cannot be the same. Please choose different locations.");
        return;
    }

    // Display trip confirmation details
    alert(`Route: ${tripData.origin} ➔ ${tripData.destination}\n` +
          `Dates: ${start} to ${end}\n` +
          `Travelers: ${pass}\n\n` +
          `WayBudget budget planner is coming soon!`);
}