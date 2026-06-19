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
 * Ensures the end date is always after the start date.
 */
function updateMinEndDate() {
    const startVal = document.getElementById('startDate').value;
    const endDateInput = document.getElementById('endDate');

    /* Reset end date restrictions if start date is cleared */
    if (!startVal) {
        endDateInput.min = "";
        return;
    }

    /* Set the minimum end date to start date + 1 day */
    const minEnd = new Date(startVal);
    minEnd.setDate(minEnd.getDate() + 1);
    endDateInput.min = minEnd.toISOString().split('T')[0];

    /* Clear invalid end dates if they precede the new start date */
    if (endDateInput.value && endDateInput.value <= startVal) {
        endDateInput.value = '';
    }
    updateRouteSummary();
}

/**
 * Calculates and displays the trip duration and summary.
 * Updates the summaryDisplay element in the DOM.
 */
function updateRouteSummary() {
    const startVal = document.getElementById('startDate').value;
    const endVal = document.getElementById('endDate').value;
    const display = document.getElementById('summaryDisplay');

    let lines = [];
    
    /* Display the selected route if both origin and destination are available */
    if (tripData.origin && tripData.destination) {
        lines.push(`Route: ${tripData.origin} ➔ ${tripData.destination}`);
    }

    /* Calculate and format travel dates and total duration */
    if (startVal && endVal) {
        lines.push(`Dates: ${startVal} to ${endVal}`);
        const start = new Date(startVal);
        const end = new Date(endVal);
        const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
        lines.push(`Duration: ${diffDays} nights, ${diffDays + 1} days`);
    }

    /* Render the aggregated summary to the user interface */
    display.innerHTML = lines.join('<br>');
}

/**
 * Handles the final submission of the travel route and displays a summary alert.
 */
function submitTrip() {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;

    /* Validate that all required fields are filled before proceeding */
    if (!tripData.origin || !tripData.destination || !start || !end) {
        alert("Please fill in Origin, Destination, and both travel dates.");
        return;
    }

    /* Display trip confirmation details */
    alert(`Route: ${tripData.origin} ➔ ${tripData.destination}\n` +
          `Dates: ${start} to ${end}.\n\n` +
          `WayBudget budget planner is coming soon, stay tuned!`);
}