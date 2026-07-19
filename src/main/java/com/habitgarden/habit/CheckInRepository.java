package com.habitgarden.habit;

import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface CheckInRepository extends JpaRepository<CheckIn, Long> {
    Optional<CheckIn> findByHabitAndDate(Habit habit, LocalDate date);
    List<CheckIn> findByHabitAndDateGreaterThanEqualOrderByDateAsc(Habit habit, LocalDate from);
}
