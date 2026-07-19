package com.habitgarden.habit;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

public class HabitDtos {

    /** Payload sent by the browser when creating a habit. */
    public record CreateHabitRequest(
            @NotBlank @Size(max = 60) String title,
            String color
    ) {}

    /**
     * One habit uploaded from a guest's browser when they log in. Carries the
     * grass history (check-in dates) so it can be merged into their account.
     */
    public record ImportHabitRequest(
            @NotBlank @Size(max = 60) String title,
            String color,
            List<String> completedDates
    ) {}

    /** What we send back to the browser for each habit, including grass data. */
    public record HabitResponse(
            Long id,
            String title,
            String color,
            List<String> completedDates, // ISO dates within the heatmap window
            boolean checkedToday,
            int totalCount,
            int currentStreak
    ) {}
}
