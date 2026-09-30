FROM python:3.11-alpine
WORKDIR /app
COPY hunt_server.py hunt.html hunt_state.json ./
EXPOSE 8400
CMD ["python3", "hunt_server.py"]
