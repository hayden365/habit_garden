# ---- build stage: compile the app with Maven ----
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -DskipTests clean package

# ---- run stage: a small image with just the JRE + the jar ----
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/app.jar app.jar
# Railway provides the PORT env var; Spring reads it via application.yml.
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
