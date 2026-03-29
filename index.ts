function parsePromotionDate(input: string): Date | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const date = new Date(input);
    
    // Check if input date is valid
    if (isNaN(date.getTime())) {
        return null;
    }

    // Past date handling
    if (date < today) {
        // Allow optional time for past dates
        return date;
    }

    // Today's date handling
    if (date.toDateString() === today.toDateString()) {
        // Today's date must have time
        if (input.split(" ").length === 1) {
            throw new Error("Today's date requires a time.");
        }
        return date;
    }

    // Future date handling
    if (date > today) {
        // Default to 1 day from now
        const defaultFutureDate = new Date(today);
        defaultFutureDate.setDate(today.getDate() + 1);
        return date || defaultFutureDate;
    }

    return null;
}

function handleSchedulePromotion(dateInput: string) {
    const parsedDate = parsePromotionDate(dateInput);
    if (!parsedDate) {
        throw new Error("Invalid date input.");
    }
    // Continue with scheduling the promotion...
}