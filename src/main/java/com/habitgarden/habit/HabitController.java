package com.habitgarden.habit;

import com.habitgarden.habit.HabitDtos.CreateHabitRequest;
import com.habitgarden.habit.HabitDtos.HabitResponse;
import com.habitgarden.habit.HabitDtos.ImportHabitRequest;
import com.habitgarden.user.User;
import com.habitgarden.user.UserRepository;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.*;

@RestController
@RequestMapping("/api")
public class HabitController {

    /** Anchor "today" to Korea time so days flip at local midnight, not UTC. */
    private static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    /** How many days of grass we send to the browser (26 weeks ~= half a year). */
    private static final int WINDOW_DAYS = 182;
    /** Caps on a single guest import, to reject abusive bulk payloads. */
    private static final int MAX_IMPORT_HABITS = 100;
    private static final int MAX_IMPORT_DATES_PER_HABIT = 400;

    private final HabitRepository habitRepository;
    private final CheckInRepository checkInRepository;
    private final UserRepository userRepository;

    public HabitController(HabitRepository habitRepository,
                           CheckInRepository checkInRepository,
                           UserRepository userRepository) {
        this.habitRepository = habitRepository;
        this.checkInRepository = checkInRepository;
        this.userRepository = userRepository;
    }

    private static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    /** Resolves the logged-in user, or 401 if there is no session. */
    private User currentUser(OAuth2User principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        String email = (String) principal.getAttributes().get("email");
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    @GetMapping("/me")
    public Map<String, Object> me(@AuthenticationPrincipal OAuth2User principal) {
        if (principal == null) {
            return Map.of("loggedIn", false);
        }
        String email = (String) principal.getAttributes().get("email");
        User u = userRepository.findByEmail(email).orElse(null);
        if (u == null) {
            return Map.of("loggedIn", false);
        }
        Map<String, Object> out = new HashMap<>();
        out.put("loggedIn", true);
        out.put("name", u.getName());
        out.put("email", u.getEmail());
        out.put("picture", u.getPicture() == null ? "" : u.getPicture());
        return out;
    }

    @GetMapping("/habits")
    public List<HabitResponse> list(@AuthenticationPrincipal OAuth2User principal) {
        User user = currentUser(principal);
        LocalDate today = today();
        LocalDate windowStart = today.minusDays(WINDOW_DAYS - 1);

        List<HabitResponse> result = new ArrayList<>();
        for (Habit habit : habitRepository.findByUserOrderByCreatedAtAsc(user)) {
            result.add(toResponse(habit, today, windowStart));
        }
        return result;
    }

    @PostMapping("/habits")
    public HabitResponse create(@AuthenticationPrincipal OAuth2User principal,
                                @Valid @RequestBody CreateHabitRequest req) {
        User user = currentUser(principal);
        Habit habit = new Habit();
        habit.setUser(user);
        habit.setTitle(req.title().trim());
        if (req.color() != null && !req.color().isBlank()) {
            habit.setColor(req.color());
        }
        habit = habitRepository.save(habit);

        LocalDate today = today();
        return toResponse(habit, today, today.minusDays(WINDOW_DAYS - 1));
    }

    /**
     * Merge a guest's browser-stored habits into the logged-in account.
     * "Add all": every uploaded habit becomes a new habit (no de-duplication).
     * Invalid, future, or duplicate dates are silently skipped. Returns the
     * account's full, refreshed habit list so the browser can render it.
     */
    @PostMapping("/habits/import")
    public List<HabitResponse> importHabits(@AuthenticationPrincipal OAuth2User principal,
                                            @RequestBody List<ImportHabitRequest> items) {
        User user = currentUser(principal);
        if (items == null) {
            items = List.of();
        }
        if (items.size() > MAX_IMPORT_HABITS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "too many habits: max " + MAX_IMPORT_HABITS);
        }

        LocalDate today = today();
        for (ImportHabitRequest req : items) {
            if (req == null || req.title() == null || req.title().isBlank()) {
                continue; // skip junk rather than failing the whole import
            }
            Habit habit = new Habit();
            habit.setUser(user);
            habit.setTitle(req.title().trim());
            if (req.color() != null && !req.color().isBlank()) {
                habit.setColor(req.color());
            }
            habit = habitRepository.save(habit);

            Set<LocalDate> seen = new HashSet<>();
            List<String> dates = req.completedDates() == null ? List.of() : req.completedDates();
            for (String raw : dates) {
                if (seen.size() >= MAX_IMPORT_DATES_PER_HABIT) {
                    break; // ignore overflow beyond the per-habit cap
                }
                LocalDate date = parseDateOrNull(raw);
                if (date == null || date.isAfter(today) || !seen.add(date)) {
                    continue; // skip unparseable, future, or duplicate dates
                }
                checkInRepository.save(new CheckIn(habit, date));
            }
        }

        LocalDate windowStart = today.minusDays(WINDOW_DAYS - 1);
        List<HabitResponse> result = new ArrayList<>();
        for (Habit habit : habitRepository.findByUserOrderByCreatedAtAsc(user)) {
            result.add(toResponse(habit, today, windowStart));
        }
        return result;
    }

    @DeleteMapping("/habits/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal OAuth2User principal,
                                       @PathVariable Long id) {
        User user = currentUser(principal);
        Habit habit = habitRepository.findByIdAndUser(id, user)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        habitRepository.delete(habit);
        return ResponseEntity.noContent().build();
    }

    /** Check or uncheck today's box. Returns the refreshed habit. */
    @PostMapping("/habits/{id}/toggle")
    public HabitResponse toggleToday(@AuthenticationPrincipal OAuth2User principal,
                                     @PathVariable Long id) {
        User user = currentUser(principal);
        Habit habit = habitRepository.findByIdAndUser(id, user)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        LocalDate today = today();
        Optional<CheckIn> existing = checkInRepository.findByHabitAndDate(habit, today);
        if (existing.isPresent()) {
            checkInRepository.delete(existing.get());
        } else {
            checkInRepository.save(new CheckIn(habit, today));
        }
        return toResponse(habit, today, today.minusDays(WINDOW_DAYS - 1));
    }

    // ---- helpers ----

    /** Parse a 'YYYY-MM-DD' string, or null if it is missing/malformed. */
    private static LocalDate parseDateOrNull(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private HabitResponse toResponse(Habit habit, LocalDate today, LocalDate windowStart) {
        List<CheckIn> checkIns =
                checkInRepository.findByHabitAndDateGreaterThanEqualOrderByDateAsc(habit, windowStart);

        Set<LocalDate> doneDates = new HashSet<>();
        List<String> completed = new ArrayList<>();
        for (CheckIn c : checkIns) {
            doneDates.add(c.getDate());
            completed.add(c.getDate().toString());
        }

        boolean checkedToday = doneDates.contains(today);

        // Current streak: count backwards from today (or yesterday) over consecutive days.
        int streak = 0;
        LocalDate cursor = checkedToday ? today : today.minusDays(1);
        while (doneDates.contains(cursor)) {
            streak++;
            cursor = cursor.minusDays(1);
        }

        return new HabitResponse(
                habit.getId(),
                habit.getTitle(),
                habit.getColor(),
                completed,
                checkedToday,
                doneDates.size(),
                streak
        );
    }
}
