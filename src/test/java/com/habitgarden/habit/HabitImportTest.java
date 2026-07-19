package com.habitgarden.habit;

import com.habitgarden.user.User;
import com.habitgarden.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.LocalDate;
import java.time.ZoneId;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for the guest-import endpoint (POST /api/habits/import),
 * which merges a guest's browser-stored habits into a logged-in account.
 */
@SpringBootTest(properties = {"GOOGLE_CLIENT_ID=test", "GOOGLE_CLIENT_SECRET=test"})
@AutoConfigureMockMvc
class HabitImportTest {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired HabitRepository habits;
    @Autowired CheckInRepository checkIns;

    /** Save a user and return an oauth2Login carrying their email attribute. */
    private RequestPostProcessor loginAs(String email) {
        User u = new User();
        u.setEmail(email);
        u.setName("Test " + email);
        users.save(u);
        return oauth2Login().attributes(a -> a.put("email", email));
    }

    private String d(int daysAgo) {
        return LocalDate.now(SEOUL).minusDays(daysAgo).toString();
    }

    @Test
    void mergesHabitsWithCheckInDates() throws Exception {
        var login = loginAs("alice@example.com");
        String body = """
            [
              {"title":"독서","color":"#2E86AB","completedDates":["%s","%s","%s"]},
              {"title":"운동","completedDates":[]}
            ]
            """.formatted(d(0), d(1), d(2));

        mvc.perform(post("/api/habits/import").with(login)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].title").value("독서"))
                .andExpect(jsonPath("$[0].totalCount").value(3))
                .andExpect(jsonPath("$[0].currentStreak").value(3))
                .andExpect(jsonPath("$[0].checkedToday").value(true))
                .andExpect(jsonPath("$[0].color").value("#2E86AB"))
                .andExpect(jsonPath("$[1].title").value("운동"))
                .andExpect(jsonPath("$[1].totalCount").value(0))
                // no color provided -> entity default
                .andExpect(jsonPath("$[1].color").value("#3FA34D"));
    }

    @Test
    void skipsInvalidFutureAndDuplicateDates() throws Exception {
        var login = loginAs("bob@example.com");
        String future = LocalDate.now(SEOUL).plusDays(1).toString();
        String body = """
            [
              {"title":"물마시기","completedDates":["%s","%s","not-a-date","%s","2026-13-40"]}
            ]
            """.formatted(d(0), d(0), future); // d(0) twice (duplicate) + today, future, garbage

        mvc.perform(post("/api/habits/import").with(login)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                // only the single valid, non-duplicate, non-future date survives
                .andExpect(jsonPath("$[0].totalCount").value(1));
    }

    @Test
    void rejectsTooManyHabits() throws Exception {
        var login = loginAs("carol@example.com");
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < 101; i++) {
            if (i > 0) sb.append(",");
            sb.append("{\"title\":\"h").append(i).append("\"}");
        }
        sb.append("]");

        mvc.perform(post("/api/habits/import").with(login)
                        .contentType(MediaType.APPLICATION_JSON).content(sb.toString()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void requiresLogin() throws Exception {
        mvc.perform(post("/api/habits/import")
                        .contentType(MediaType.APPLICATION_JSON).content("[]"))
                .andExpect(status().isUnauthorized());
    }
}
