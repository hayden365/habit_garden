package com.habitgarden.habit;

import jakarta.persistence.*;
import java.time.LocalDate;

@Entity
@Table(
    name = "check_ins",
    uniqueConstraints = @UniqueConstraint(columnNames = {"habit_id", "date"})
)
public class CheckIn {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "habit_id")
    private Habit habit;

    @Column(nullable = false)
    private LocalDate date;

    protected CheckIn() {}

    public CheckIn(Habit habit, LocalDate date) {
        this.habit = habit;
        this.date = date;
    }

    public Long getId() { return id; }
    public Habit getHabit() { return habit; }
    public LocalDate getDate() { return date; }
}
