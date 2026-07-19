package com.habitgarden.habit;

import com.habitgarden.user.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface HabitRepository extends JpaRepository<Habit, Long> {
    List<Habit> findByUserOrderByCreatedAtAsc(User user);
    Optional<Habit> findByIdAndUser(Long id, User user);
}
